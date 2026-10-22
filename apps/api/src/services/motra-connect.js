import { signInWithPassword, MotraError, MotraErrorCode } from '@digitaltwin/motra';
import { publicConnection } from '@digitaltwin/connections';
import { HttpError } from '../utils/http-error.js';

export const MOTRA_PROVIDER = 'motra';

/**
 * Conectar Motra con email y contraseña: se hace login contra Firebase y se guarda (cifrado) solo
 * el refresh token, no la contraseña. Después se encola la carga inicial. Si cambias la contraseña
 * en Motra, el token deja de valer y la conexión pasa a "hay que reconectar".
 * @param {object} deps
 * @param {{ get: Function, save: Function }} deps.store
 * @param {(userId: string, provider: string) => Promise<void>} [deps.onConnected]
 * @param {(credentials: { email: string, password: string }) => ReturnType<typeof signInWithPassword>} [deps.signIn]
 * @param {() => number} [deps.now]
 * @param {import('pino').Logger} [deps.logger]
 */
export function createMotraConnect({
  store,
  onConnected,
  signIn = (credentials) => signInWithPassword(credentials),
  now = Date.now,
  logger,
}) {
  return {
    async connect(userId, { email, password }) {
      let session;
      try {
        session = await signIn({ email, password });
      } catch (err) {
        if (err instanceof MotraError && err.code === MotraErrorCode.INVALID_CREDENTIALS) {
          throw HttpError.badRequest('Motra no acepta ese email o contraseña', {
            code: 'INVALID_CREDENTIALS',
          });
        }
        throw new HttpError(502, `No se pudo hablar con Motra: ${err.message}`, {
          code: 'PROVIDER_ERROR',
        });
      }
      // Al reconectar se conserva lo sincronizado: la siguiente sincronización sigue donde iba
      const previous = await store.get(userId, MOTRA_PROVIDER);
      const connection = await store.save({
        ...(previous && { lastSync: previous.lastSync, records: previous.records }),
        userId,
        provider: MOTRA_PROVIDER,
        status: 'connected',
        account: session.email,
        externalUserId: session.accountId,
        connectedAt: new Date(now()).toISOString(),
        credentials: { refreshToken: session.refreshToken },
      });
      logger?.info({ account: session.accountId }, 'Motra conectado');
      if (!previous?.lastSync) {
        try {
          await onConnected?.(userId, MOTRA_PROVIDER);
        } catch (err) {
          logger?.error({ err }, 'No se pudo encolar la carga inicial de Motra');
        }
      }
      return publicConnection(connection);
    },
  };
}
