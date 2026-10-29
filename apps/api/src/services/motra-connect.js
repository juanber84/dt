import {
  signInWithPassword,
  createMotraClient,
  createMotraStrengthApp,
  MotraError,
  MotraErrorCode,
} from '@digitaltwin/motra';
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
 * @param {string} [deps.apiKey] API key de Firebase de la app de Motra
 * @param {(credentials: { email: string, password: string }) => ReturnType<typeof signInWithPassword>} [deps.signIn]
 * @param {() => number} [deps.now]
 * @param {import('pino').Logger} [deps.logger]
 */
export function createMotraConnect({
  store,
  onConnected,
  apiKey,
  signIn = (credentials) => signInWithPassword({ ...credentials, apiKey }),
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
          throw HttpError.badRequest('No acepta ese email o contraseña', {
            code: 'INVALID_CREDENTIALS',
          });
        }
        throw new HttpError(502, `No se pudo hablar con la app de fuerza: ${err.message}`, {
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

/**
 * Motra como app de fuerza de un usuario (para las plantillas del MCP), o null si no la tiene
 * conectada. Crearla no llama a nadie: el login con el refresh token va con la primera petición.
 * Si Firebase rota el refresh token, se guarda el nuevo.
 * @param {object} deps
 * @param {{ get: Function, save: Function }} deps.store
 * @param {string} [deps.apiKey]
 * @param {(options: object) => ReturnType<typeof createMotraClient>} [deps.createClient]
 */
export function createMotraStrength({
  store,
  apiKey,
  createClient = (options) => createMotraClient({ ...options, apiKey }),
}) {
  return {
    async forUser(userId) {
      const connection = await store.get(userId, MOTRA_PROVIDER);
      if (connection?.status !== 'connected' || !connection.credentials?.refreshToken) return null;
      const client = createClient({
        refreshToken: connection.credentials.refreshToken,
        onRefreshToken: async (refreshToken) => {
          const latest = (await store.get(userId, MOTRA_PROVIDER)) ?? connection;
          await store.save({ ...latest, credentials: { ...latest.credentials, refreshToken } });
        },
      });
      return createMotraStrengthApp({ client, accountId: connection.externalUserId });
    },
  };
}
