import { randomBytes } from 'node:crypto';
import {
  GoogleHealthAuth,
  GoogleHealthClient,
  dataTypesForScopes,
  DEFAULT_SCOPES,
  WRITE_SCOPES,
} from '@digitaltwin/google-health';

/** Lectura de todo y escritura de comidas y medidas. */
export const GOOGLE_SCOPES = Object.freeze([...DEFAULT_SCOPES, ...Object.values(WRITE_SCOPES)]);

export const GOOGLE_PROVIDER = 'google-health';
export const GOOGLE_CALLBACK_PATH = '/api/v1/connections/google-health/callback';
export const OAUTH_STATE_COOKIE = 'dt_oauth_state';

/**
 * Conexión con Google Health por OAuth:
 *   start → URL de Google (y un `state` de un solo uso ligado al usuario y al navegador)
 *   finish (callback de Google) → cambia el código por tokens y guarda la conexión.
 *
 * El callback llega como navegación desde accounts.google.com, así que la cookie de sesión
 * (SameSite=Strict) no viaja: el usuario sale del `state`, que solo conoce quien empezó.
 *
 * @param {object} deps
 * @param {{ clientId: string, clientSecret: string }} deps.oauth
 * @param {string} deps.publicUrl  Origen del front (p. ej. http://localhost:3081).
 * @param {ReturnType<typeof import('@digitaltwin/connections').createMemoryConnectionStore>} deps.store
 * @param {Pick<GoogleHealthAuth, 'getAuthUrl' | 'exchangeCode' | 'revoke'>} [deps.auth]
 * @param {(credentials: object) => Promise<object>} [deps.describeAccount]
 * @param {number} [deps.ttlMs]
 * @param {() => number} [deps.now]
 * @param {(userId: string, provider: string) => Promise<void>} [deps.onConnected]
 * @param {import('pino').Logger} [deps.logger]
 */
export function createGoogleConnect({
  oauth,
  onConnected,
  publicUrl,
  store,
  auth = new GoogleHealthAuth({ ...oauth, redirectUri: publicUrl + GOOGLE_CALLBACK_PATH }),
  describeAccount = (credentials) => describeGoogle(credentials, oauth),
  ttlMs = 10 * 60_000,
  now = Date.now,
  logger,
}) {
  const pending = new Map();
  const back = (params) =>
    `${publicUrl}/admin/connections?${new URLSearchParams({ provider: GOOGLE_PROVIDER, ...params })}`;

  return {
    ttlMs,

    /** @returns {{ url: string, state: string }} */
    start(userId) {
      for (const [key, value] of pending) if (value.expiresAt <= now()) pending.delete(key);
      const state = randomBytes(24).toString('base64url');
      pending.set(state, { userId, expiresAt: now() + ttlMs });
      return { url: auth.getAuthUrl({ state, scopes: GOOGLE_SCOPES }), state };
    },

    /**
     * Procesa el callback. Nunca lanza: devuelve a dónde mandar al navegador (Conexiones con
     * ?result=connected o ?result=error&reason=...).
     */
    async finish({ state, code, error, browserState }) {
      const login = state && pending.get(state);
      if (state) pending.delete(state);
      if (error)
        return back({ result: 'error', reason: error === 'access_denied' ? 'denied' : error });
      // El state tiene que existir, no haber caducado y venir del mismo navegador que empezó
      if (!login || login.expiresAt <= now() || browserState !== state || !code) {
        return back({ result: 'error', reason: 'expired' });
      }

      let credentials;
      try {
        credentials = await auth.exchangeCode(code);
      } catch (err) {
        logger?.warn({ err }, 'Google no ha aceptado el código');
        return back({ result: 'error', reason: 'exchange' });
      }

      let details = {};
      try {
        details = await describeAccount(credentials);
      } catch (err) {
        logger?.warn({ err }, 'Google conectado, pero no se pudieron leer los dispositivos');
      }

      const previous = await store.get(login.userId, GOOGLE_PROVIDER);
      await store.save({
        ...(previous && { lastSync: previous.lastSync, records: previous.records }),
        userId: login.userId,
        provider: GOOGLE_PROVIDER,
        status: 'connected',
        account: 'Cuenta de Google',
        // Los webhooks de Google traen este id: así se sabe de quién es cada aviso
        externalUserId: details.healthUserId ?? credentials.healthUserId ?? undefined,
        connectedAt: new Date(now()).toISOString(),
        details,
        credentials,
      });
      logger?.info({ userId: login.userId, types: details.dataTypes }, 'Google Health conectado');
      try {
        await onConnected?.(login.userId, GOOGLE_PROVIDER);
      } catch (err) {
        logger?.error({ err }, 'No se pudo encolar la carga inicial de Google');
      }
      return back({ result: 'connected' });
    },

    /** Al desconectar, revoca el permiso en Google (si falla, se desconecta igual). */
    async revoke(connection) {
      if (!connection?.credentials) return;
      try {
        await auth.revoke(connection.credentials);
      } catch (err) {
        logger?.warn({ err }, 'No se pudo revocar el permiso en Google');
      }
    },
  };
}

/** Dispositivos vinculados y cuántos tipos de datos se han concedido, para enseñar en el front. */
async function describeGoogle(credentials, { clientId, clientSecret }) {
  const client = new GoogleHealthClient({ credentials, clientId, clientSecret });
  const devices = await client.listPairedDevices().catch(() => []);
  const granted = new Set(String(credentials.scope ?? '').split(' '));
  return {
    healthUserId: credentials.healthUserId ?? null,
    dataTypes: dataTypesForScopes(credentials.scope ?? '').length,
    // En la pantalla de Google se pueden desmarcar: qué se puede escribir de verdad
    canWrite: {
      nutrition: granted.has(WRITE_SCOPES.NUTRITION),
      measurements: granted.has(WRITE_SCOPES.HEALTH_METRICS),
    },
    devices: devices.map((d) => ({
      name: d.displayName ?? d.deviceName ?? d.model ?? 'Dispositivo',
      model: d.model ?? d.deviceModel ?? null,
    })),
  };
}
