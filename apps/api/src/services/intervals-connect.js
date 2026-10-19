import {
  createIntervalsClient,
  IntervalsError,
  IntervalsErrorCode,
} from '@digitaltwin/intervals-icu';
import { publicConnection } from '@digitaltwin/connections';
import { HttpError } from '../utils/http-error.js';

export const INTERVALS_PROVIDER = 'intervals-icu';

/**
 * Conectar intervals.icu con la clave personal (ajustes de intervals → Developer Settings): se
 * comprueba contra la API, se guarda cifrada y se encola la carga inicial.
 * @param {object} deps
 * @param {{ get: Function, save: Function }} deps.store
 * @param {(userId: string, provider: string) => Promise<void>} [deps.onConnected]
 * @param {(apiKey: string) => { athlete: () => Promise<object> }} [deps.createClient]
 * @param {() => number} [deps.now]
 * @param {import('pino').Logger} [deps.logger]
 */
export function createIntervalsConnect({
  store,
  onConnected,
  createClient = (apiKey) => createIntervalsClient({ apiKey }),
  now = Date.now,
  logger,
}) {
  return {
    async connect(userId, apiKey) {
      let athlete;
      try {
        athlete = await createClient(apiKey).athlete();
      } catch (err) {
        if (err instanceof IntervalsError && err.code === IntervalsErrorCode.INVALID_KEY) {
          throw HttpError.badRequest('intervals.icu no acepta esa clave', { code: 'INVALID_KEY' });
        }
        throw new HttpError(502, `No se pudo hablar con intervals.icu: ${err.message}`, {
          code: 'PROVIDER_ERROR',
        });
      }
      // Al reconectar se conserva lo sincronizado: la siguiente sincronización sigue donde iba
      const previous = await store.get(userId, INTERVALS_PROVIDER);
      const connection = await store.save({
        ...(previous && { lastSync: previous.lastSync, records: previous.records }),
        userId,
        provider: INTERVALS_PROVIDER,
        status: 'connected',
        account: athlete.name ?? athlete.id,
        externalUserId: athlete.id,
        connectedAt: new Date(now()).toISOString(),
        credentials: { apiKey },
      });
      logger?.info({ athlete: athlete.id }, 'intervals.icu conectado');
      if (!previous?.lastSync) {
        try {
          await onConnected?.(userId, INTERVALS_PROVIDER);
        } catch (err) {
          logger?.error({ err }, 'No se pudo encolar la carga inicial de intervals.icu');
        }
      }
      return publicConnection(connection);
    },
  };
}
