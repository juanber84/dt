import { notificationToQuery } from '@digitaltwin/google-health';
import { createEntries } from './entries.js';
import { JOBS, PRIORITY } from '@digitaltwin/queue';
import { utcDay, DAY_MS } from '@digitaltwin/timeline';
import { HttpError } from '../utils/http-error.js';

import { TELEGRAM } from './telegram-link.js';

export { TELEGRAM };
const GOOGLE = 'google-health';
// Los avisos de Google llegan a ráfagas: uno por usuario, tipo y día cada 30 s
const DEBOUNCE_SECONDS = 30;

/**
 * Buzón de entrada: todo lo que llega de fuera (webhooks de proveedores, el bot) se apunta en
 * `inbox` tal cual y se traduce a un trabajo de la cola o a un raw_record:
 *
 *   dato  (meal.logged del bot)            → raw_record + normalize
 *   orden (aviso de Google, sync.requested) → fetch / sync
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createPipeline>} deps.pipeline
 * @param {ReturnType<typeof import('@digitaltwin/queue').createQueue>} deps.queue
 * @param {ReturnType<typeof import('@digitaltwin/connections').createDbConnectionStore>} deps.connections
 * @param {ReturnType<typeof import('./telegram-link.js').createTelegramLink>} [deps.telegramLink]
 * @param {string} [deps.timeZone]  La del usuario (los días de un periodo)
 * @param {import('pino').Logger} [deps.logger]
 */
export function createInbox({ pipeline, queue, connections, telegramLink, timeZone, logger }) {
  const { store } = pipeline;
  const entries = createEntries({ pipeline, queue, timeZone });

  async function settle(id, fn) {
    try {
      const result = await fn();
      await store.markInbox(id, result?.status ?? 'routed');
      return result;
    } catch (err) {
      await store.markInbox(id, 'error', err.message).catch(() => {});
      throw err;
    }
  }

  return {
    /** Avisos de Google Health ("hay cambios en X"): se descarga cada día afectado. */
    async googleNotifications(notifications) {
      for (const notification of notifications) {
        const { raw, ...summary } = notification;
        const id = await store.recordInbox({
          provider: GOOGLE,
          kind: 'command',
          type: `${notification.dataType}.${notification.operation ?? 'changed'}`.toLowerCase(),
          payload: raw ?? summary,
        });
        await settle(id, async () => {
          const connection = await connections.findByExternalUser(
            GOOGLE,
            notification.healthUserId,
          );
          const query = notificationToQuery(notification);
          if (!connection || connection.status !== 'connected' || !query) {
            logger?.info(
              { healthUserId: notification.healthUserId },
              'aviso de Google sin conexión',
            );
            return { status: 'ignored' };
          }
          // Días UTC completos: cada día descargado reemplaza al anterior
          const from = utcDay(query.from);
          const to = new Date(utcDay(new Date(query.to.getTime() - 1)).getTime() + DAY_MS);
          const key = `${connection.userId}:${query.dataType}:${from.toISOString()}:${to.toISOString()}`;
          await queue.sendDebounced(
            JOBS.FETCH,
            {
              userId: connection.userId,
              provider: GOOGLE,
              kind: query.dataType,
              from: from.toISOString(),
              to: to.toISOString(),
              priority: PRIORITY.LIVE,
            },
            { priority: PRIORITY.LIVE, group: { id: GOOGLE } },
            DEBOUNCE_SECONDS,
            key,
          );
          return { status: 'routed' };
        });
      }
    },

    /**
     * Eventos de nuestras propias apps (el bot) por /webhooks/digitaltwin.
     * @param {{ type: string, telegramUserId?: number, data?: object }} event
     * @returns {Promise<object>} lo que se devuelve al que llama
     */
    async digitaltwinEvent(event) {
      const connection =
        event.telegramUserId === undefined
          ? null
          : await connections.findByExternalUser(TELEGRAM, event.telegramUserId);
      const userId = connection?.userId ?? null;
      const id = await store.recordInbox({
        provider: 'digitaltwin',
        kind: event.type === 'meal.logged' || event.type === 'entry.logged' ? 'data' : 'command',
        type: event.type,
        userId,
        payload: event,
      });

      return settle(id, async () => {
        // Vincular es lo único que se puede hacer sin estar vinculado
        if (event.type === 'account.link') {
          const linked = await telegramLink?.finish(event.data.code, {
            telegramUserId: event.telegramUserId,
            username: event.data.username,
          });
          if (!linked) {
            throw new HttpError(422, 'El código no vale o ha caducado: pide otro en la web', {
              code: 'LINK_CODE_INVALID',
            });
          }
          logger?.info({ userId: linked.userId }, 'Telegram vinculado');
          return { status: 'routed', linked: true, email: linked.email };
        }

        if (!userId) {
          throw new HttpError(
            422,
            'Tu Telegram no está vinculado: en la web, Conexiones → Bot de Telegram → Vincular',
            { code: 'TELEGRAM_NOT_LINKED' },
          );
        }

        if (event.type === 'entry.logged') {
          const { id: entryId, ...entry } = event.data;
          const saved = await entries.add(userId, entry, { channel: TELEGRAM, id: entryId });
          return { status: 'routed', id: saved.id };
        }

        if (event.type === 'meal.logged') {
          const entry = event.data;
          const times = entry.dishes.map((d) => Date.parse(d.eatenAt));
          const raw = await pipeline.ingest({
            userId,
            provider: 'digitaltwin',
            kind: 'meal',
            externalId: entry.id,
            periodStart: Math.min(...times),
            periodEnd: Math.max(...times) + 1,
            payload: { ...entry, channel: TELEGRAM },
          });
          return { status: 'routed', id: raw.id, changed: raw.changed };
        }

        if (event.type === 'sync.requested') {
          const job = await requestSync(userId, event.data.provider, 'telegram');
          return { status: 'routed', queued: Boolean(job) };
        }

        throw HttpError.badRequest(`Tipo de evento desconocido: ${event.type}`);
      });
    },

    requestSync,

    /** Recién conectado: carga inicial del histórico. */
    async connected(userId, provider) {
      await queue.send(
        JOBS.BACKFILL,
        { userId, provider },
        { singletonKey: `${provider}:${userId}`, priority: PRIORITY.LIVE },
      );
    },

    /** Al desconectar: se para la carga inicial que hubiera en marcha. */
    async disconnected(userId, provider) {
      await store.cancelBackfills(userId, provider);
    },
  };

  async function requestSync(userId, provider, reason = 'manual') {
    return queue.send(
      JOBS.SYNC,
      { userId, provider, reason },
      { singletonKey: `${provider}:${userId}`, priority: PRIORITY.LIVE },
    );
  }
}
