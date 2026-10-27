import { JOBS } from '@digitaltwin/queue';
import { TITLES } from '@digitaltwin/clinical';
import { refreshTokenExpiresAt } from '@digitaltwin/google-health';

const PROVIDER_NAMES = {
  'google-health': 'Google Health',
  xiaomi: 'Xiaomi',
  'intervals-icu': 'intervals.icu',
  motra: 'Fuerza (experimental)',
};

/** "2026-10-07" → "7/10" */
const EXPIRING_MS = 2 * 24 * 3600 * 1000;
const shortDate = (iso) => (iso ? `${Number(iso.slice(8))}/${Number(iso.slice(5, 7))}` : null);

/** Fecha local (YYYY-MM-DD) de `at` en `timeZone`. */
export const localDate = (at, timeZone) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);

/** Los avisos, cada uno con su texto y adónde lleva al tocarlo. */
export const messages = {
  clinicalReady(doc, extraction) {
    const title = TITLES[extraction.type] ?? 'Informe';
    const date = extraction.date ?? doc.requestedDate;
    return {
      kind: 'clinical-ready',
      dedupeKey: doc.id,
      title: 'Informe listo para revisar',
      body: `${title}${date ? ` del ${shortDate(date)}` : ''}: mira lo que ha leído la IA y confírmalo.`,
      // Al tocarla: su día con el informe abierto en el lateral
      url: date ? `/day/${date}?event=clinical-${doc.id}` : `/day?event=clinical-${doc.id}`,
    };
  },

  connectionExpired(connection, today) {
    const name = PROVIDER_NAMES[connection.provider] ?? connection.provider;
    return {
      kind: 'connection-broken',
      // Como mucho uno al día por conexión
      dedupeKey: `${connection.provider}:${today}`,
      title: `${name} se ha desconectado`,
      body: connection.error ?? 'Vuelve a conectarlo para que sigan llegando tus datos.',
      url: '/admin/connections',
    };
  },

  /** El permiso de una conexión caduca pronto (Google con la app de OAuth en modo Prueba: 7 días). */
  connectionExpiring(connection, expiresAt, today, timeZone) {
    const name = PROVIDER_NAMES[connection.provider] ?? connection.provider;
    const when = new Intl.DateTimeFormat('es-ES', {
      timeZone,
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(expiresAt);
    return {
      kind: 'connection-broken',
      dedupeKey: `${connection.provider}:expiring:${today}`,
      title: `${name} se desconecta pronto`,
      body: `El permiso caduca el ${when}. Vuelve a conectarlo antes para no perder datos ni avisos.`,
      url: '/admin/connections',
    };
  },

  mealsMissing(today) {
    return {
      kind: 'meals-missing',
      dedupeKey: today,
      title: '¿Qué has comido hoy?',
      body: 'No has apuntado nada en todo el día. Díselo al bot o apúntalo en la app.',
      url: '/day',
    };
  },
};

/** Encola el aviso; el job `push` decide si sale (preferencias, silencio, máximo). */
export const createNotifier =
  ({ queue }) =>
  (userId, notification) =>
    queue.send(JOBS.PUSH, { userId, notification });

/**
 * Envuelve el almacén de conexiones: al pasar a `expired` (lo marca cada proveedor a su manera),
 * llama a `onExpired`. Así no hay que tocar cada proveedor.
 */
export function withExpiryAlerts(connections, onExpired, logger) {
  return {
    ...connections,
    async save(connection) {
      const before =
        connection.status === 'expired'
          ? await connections.get(connection.userId, connection.provider)
          : null;
      const saved = await connections.save(connection);
      if (connection.status === 'expired' && before?.status !== 'expired') {
        await Promise.resolve(onExpired(connection)).catch((err) =>
          logger?.warn({ err }, 'No se pudo avisar de la conexión caída'),
        );
      }
      return saved;
    },
  };
}

/**
 * Reglas que se miran a una hora (cron), para cada usuario con notificaciones.
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/push').createPush>} deps.push
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createTimelineQueries>} deps.queries
 * @param {(userId: string, notification: object) => Promise<unknown>} deps.notify
 * @param {string} deps.timeZone
 * @param {() => Date} [deps.now]
 */
export function createPushRules({
  push,
  queries,
  connections,
  notify,
  timeZone,
  now = () => new Date(),
}) {
  const rules = {
    /** Una vez al día, si a su permiso de Google le quedan menos de 2 días. */
    async 'connection-expiring'(userId, at) {
      const connection = await connections?.get(userId, 'google-health');
      if (connection?.status !== 'connected') return false;
      const expiresAt = refreshTokenExpiresAt(connection.credentials);
      if (!expiresAt || expiresAt - at > EXPIRING_MS) return false;
      await notify(
        userId,
        messages.connectionExpiring(connection, expiresAt, localDate(at, timeZone), timeZone),
      );
      return true;
    },

    /**
     * A media tarde, si no hay ninguna comida apuntada hoy (bot o app). Fuera de casa o enfermo
     * (un periodo que incluye hoy) no se avisa: esos días no hace falta apuntar.
     */
    async 'meals-missing'(userId, at) {
      const today = localDate(at, timeZone);
      const from = new Date(`${today}T00:00:00Z`);
      // Margen de un día a cada lado y se filtra por el día local (las comidas van por día local).
      // Los periodos, desde mucho antes: unas vacaciones pueden haber empezado hace días
      const [meals, periods] = await Promise.all([
        queries.episodes({
          userId,
          from: new Date(from.getTime() - 24 * 3600 * 1000),
          to: at,
          kinds: ['meal'],
          timeZone,
        }),
        queries.episodes({
          userId,
          from: new Date(from.getTime() - 90 * 24 * 3600 * 1000),
          to: at,
          kinds: ['period'],
          timeZone,
        }),
      ]);
      if (periods.some((p) => p.summary?.from <= today && p.summary?.to >= today)) return false;
      const todays = meals.filter((m) => localDate(new Date(m.start), timeZone) === today);
      if (todays.length) return false;
      await notify(userId, messages.mealsMissing(today));
      return true;
    },
  };

  return {
    names: Object.keys(rules),
    /** @returns {Promise<{ users: number, notified: number }>} */
    async run(rule) {
      const check = rules[rule];
      if (!check) return { skipped: 'unknown-rule' };
      const at = now();
      const users = await push.subscribedUsers();
      let notified = 0;
      for (const userId of users) {
        const settings = await push.settings(userId);
        if (settings.disabled.includes(rule)) continue;
        if (await check(userId, at)) notified++;
      }
      return { users: users.length, notified };
    },
  };
}
