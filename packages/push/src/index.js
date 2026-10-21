import webpush from 'web-push';

/**
 * Tipos de aviso. Cada usuario puede apagar los que no quiera (notification_settings.disabled).
 * `test` no cuenta para el máximo diario ni se puede apagar: es el botón de prueba.
 */
export const KINDS = Object.freeze({
  'clinical-ready': {
    label: 'Informes leídos',
    description: 'Cuando la IA termina de leer un informe y está listo para revisar.',
  },
  'connection-broken': {
    label: 'Conexiones caídas',
    description: 'Si Google, Xiaomi o intervals.icu dejan de sincronizar y hay que reconectar.',
  },
  'backup-failed': {
    label: 'Copias de seguridad',
    description:
      'Si falla la copia de seguridad diaria de la base de datos (solo administradores).',
  },
  'meals-missing': {
    label: 'Comidas sin apuntar',
    description: 'A media tarde, si no has apuntado nada en todo el día.',
  },
});

export const DEFAULT_SETTINGS = Object.freeze({
  disabled: [],
  quietFrom: '22:00',
  quietTo: '08:00',
  maxPerDay: 6,
});

const hhmm = (value) => String(value).slice(0, 5);

/**
 * Suscripciones, preferencias e historial en la BD (migración 0015).
 * @param {{ db: import('postgres').Sql }} deps
 */
export function createDbPushStore({ db }) {
  return {
    async saveSubscription(userId, { endpoint, keys }, device) {
      // Si el endpoint ya era de otro usuario (mismo navegador, otra cuenta), pasa a este
      await db`
        insert into push_subscriptions (user_id, endpoint, p256dh, auth, device)
        values (${userId}, ${endpoint}, ${keys.p256dh}, ${keys.auth}, ${device ?? null})
        on conflict (endpoint) do update set
          user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
          device = excluded.device
      `;
    },
    async removeSubscription(userId, endpoint) {
      await db`delete from push_subscriptions where user_id = ${userId} and endpoint = ${endpoint}`;
    },
    /** El servicio de push dice que ya no existe (desinstalada, permiso quitado). */
    async dropEndpoint(endpoint) {
      await db`delete from push_subscriptions where endpoint = ${endpoint}`;
    },
    async subscriptions(userId) {
      const rows = await db`
        select * from push_subscriptions where user_id = ${userId} order by created_at
      `;
      return rows.map((r) => ({
        id: r.id,
        endpoint: r.endpoint,
        keys: { p256dh: r.p256dh, auth: r.auth },
        device: r.device,
        createdAt: r.created_at.toISOString(),
        lastSentAt: r.last_sent_at?.toISOString() ?? null,
      }));
    },
    async touchSubscriptions(endpoints) {
      if (endpoints.length) {
        await db`update push_subscriptions set last_sent_at = now() where endpoint = any(${endpoints})`;
      }
    },
    /** Usuarios con algún dispositivo suscrito (las reglas del worker los recorren). */
    async subscribedUsers() {
      const rows = await db`select distinct user_id from push_subscriptions`;
      return rows.map((r) => r.user_id);
    },

    async settings(userId) {
      const [row] = await db`select * from notification_settings where user_id = ${userId}`;
      if (!row) return { ...DEFAULT_SETTINGS };
      return {
        disabled: row.disabled,
        quietFrom: hhmm(row.quiet_from),
        quietTo: hhmm(row.quiet_to),
        maxPerDay: row.max_per_day,
      };
    },
    async saveSettings(userId, s) {
      await db`
        insert into notification_settings (user_id, disabled, quiet_from, quiet_to, max_per_day)
        values (${userId}, ${s.disabled}, ${s.quietFrom}, ${s.quietTo}, ${s.maxPerDay})
        on conflict (user_id) do update set
          disabled = excluded.disabled, quiet_from = excluded.quiet_from,
          quiet_to = excluded.quiet_to, max_per_day = excluded.max_per_day, updated_at = now()
      `;
    },

    /** Apunta el aviso; null si ya se mandó uno con la misma dedupe_key. */
    async log(userId, n) {
      const [row] = await db`
        insert into notification_log (user_id, kind, dedupe_key, title, body, url)
        values (${userId}, ${n.kind}, ${n.dedupeKey ?? null}, ${n.title}, ${n.body ?? null},
          ${n.url ?? null})
        on conflict (user_id, kind, dedupe_key) where dedupe_key is not null do nothing
        returning id
      `;
      return row?.id ?? null;
    },
    async delivered(logId, count) {
      await db`update notification_log set delivered = ${count} where id = ${logId}`;
    },
    /** Avisos mandados desde `since` (sin los de prueba), para el máximo diario. */
    async countSince(userId, since) {
      const [row] = await db`
        select count(*)::int as n from notification_log
        where user_id = ${userId} and sent_at >= ${since} and kind <> 'test'
      `;
      return row.n;
    },
    async history(userId, limit = 20) {
      const rows = await db`
        select * from notification_log where user_id = ${userId}
        order by sent_at desc limit ${limit}
      `;
      return rows.map((r) => ({
        id: Number(r.id),
        kind: r.kind,
        title: r.title,
        body: r.body,
        url: r.url,
        sentAt: r.sent_at.toISOString(),
        delivered: r.delivered,
      }));
    },
  };
}

// --- Horas en la zona del usuario -----------------------------------------------------------

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), mi: get('minute') };
}

/** El instante UTC de una hora local (y/m/d h:mi) en `timeZone`. */
export function zonedTime({ y, m, d, h, mi }, timeZone) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const seen = localParts(new Date(guess), timeZone);
  const offset = Date.UTC(seen.y, seen.m - 1, seen.d, seen.h, seen.mi) - guess;
  return new Date(guess - offset);
}

const minutes = (value) => {
  const [h, mi] = value.split(':').map(Number);
  return h * 60 + mi;
};

/** Si `at` cae en las horas de silencio, cuándo acaban; si no, null. */
export function quietUntil(at, { quietFrom, quietTo }, timeZone) {
  const local = localParts(at, timeZone);
  const now = local.h * 60 + local.mi;
  const from = minutes(quietFrom);
  const to = minutes(quietTo);
  if (from === to) return null;
  const inside = from < to ? now >= from && now < to : now >= from || now < to;
  if (!inside) return null;
  // Acaba hoy si aún no es la hora de fin; si no (de 22:00 a 08:00 y son las 23:00), mañana
  const end = zonedTime({ ...local, h: Math.floor(to / 60), mi: to % 60 }, timeZone);
  return now < to ? end : new Date(end.getTime() + 24 * 3600 * 1000);
}

/** Medianoche local de `at` (para contar los avisos del día). */
export function localMidnight(at, timeZone) {
  return zonedTime({ ...localParts(at, timeZone), h: 0, mi: 0 }, timeZone);
}

// --- Envío ----------------------------------------------------------------------------------------

/**
 * Notificaciones push. Por usuario: sus dispositivos, sus tipos apagados, sus horas de silencio
 * y su máximo diario.
 *
 * @param {object} options
 * @param {ReturnType<typeof createDbPushStore>} options.store
 * @param {{ publicKey: string, privateKey: string, subject: string }} options.vapid
 *   subject: una URL nuestra o mailto: (el servicio de push lo usa para contactar si hay abuso).
 * @param {string} [options.timeZone]  Zona para las horas de silencio (aún es la misma para todos).
 * @param {typeof webpush.sendNotification} [options.send]  Para tests.
 * @param {() => Date} [options.now]
 * @param {import('pino').Logger} [options.logger]
 */
export function createPush({
  store,
  vapid,
  timeZone = 'Europe/Madrid',
  send = webpush.sendNotification.bind(webpush),
  now = () => new Date(),
  logger,
}) {
  const vapidDetails = {
    subject: vapid.subject,
    publicKey: vapid.publicKey,
    privateKey: vapid.privateKey,
  };

  /** A todos los dispositivos del usuario; los que ya no existen se borran. */
  async function deliver(userId, payload) {
    const subs = await store.subscriptions(userId);
    const ok = [];
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await send({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload), {
            vapidDetails,
            TTL: 24 * 3600,
            urgency: 'normal',
          });
          ok.push(sub.endpoint);
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await store.dropEndpoint(sub.endpoint);
          } else {
            logger?.warn({ err: err.message, status: err.statusCode, userId }, 'push: no enviado');
          }
        }
      }),
    );
    await store.touchSubscriptions(ok);
    return ok.length;
  }

  return {
    publicKey: vapid.publicKey,

    subscribe: (userId, subscription, device) =>
      store.saveSubscription(userId, subscription, device),
    unsubscribe: (userId, endpoint) => store.removeSubscription(userId, endpoint),
    devices: (userId) => store.subscriptions(userId),
    subscribedUsers: () => store.subscribedUsers(),
    settings: (userId) => store.settings(userId),
    history: (userId, limit) => store.history(userId, limit),

    async updateSettings(userId, patch) {
      const next = { ...(await store.settings(userId)), ...patch };
      next.disabled = [...new Set(next.disabled)].filter((k) => k in KINDS);
      await store.saveSettings(userId, next);
      return next;
    },

    /**
     * Manda un aviso si toca. Devuelve qué ha pasado:
     *   sent (delivered: a cuántos dispositivos) · disabled · duplicate · limit · no-devices
     *   quiet (retryAt: cuándo acaban las horas de silencio, para volver a intentarlo)
     * @param {string} userId
     * @param {{ kind: string, title: string, body?: string, url?: string, dedupeKey?: string,
     *   badge?: number }} notification
     */
    async notify(userId, notification) {
      const { kind } = notification;
      const test = kind === 'test';
      if (!(await store.subscriptions(userId)).length) return { status: 'no-devices' };
      const settings = await store.settings(userId);
      if (!test) {
        if (settings.disabled.includes(kind)) return { status: 'disabled' };
        const retryAt = quietUntil(now(), settings, timeZone);
        if (retryAt) return { status: 'quiet', retryAt };
        const today = await store.countSince(userId, localMidnight(now(), timeZone));
        if (today >= settings.maxPerDay) return { status: 'limit' };
      }
      const logId = await store.log(userId, notification);
      if (!logId) return { status: 'duplicate' };
      const delivered = await deliver(userId, {
        title: notification.title,
        body: notification.body ?? '',
        url: notification.url ?? '/',
        // Avisos del mismo tipo y clave se sustituyen en el centro de notificaciones
        tag: `${kind}:${notification.dedupeKey ?? logId}`,
        ...(notification.badge != null && { badge: notification.badge }),
      });
      await store.delivered(logId, delivered);
      return { status: 'sent', delivered };
    },
  };
}

/** Claves VAPID nuevas (una vez por entorno: npx web-push generate-vapid-keys también vale). */
export const generateVapidKeys = () => webpush.generateVAPIDKeys();
