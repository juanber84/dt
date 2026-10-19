import { OAuth2Client } from 'google-auth-library';
import { DEFAULT_SCOPES } from './data-types.js';
import { toGoogleHealthError } from './errors.js';

export const API_URL = 'https://health.googleapis.com/v4';

/**
 * @typedef {object} GoogleHealthCredentials
 * Tokens en el formato nativo de Google (se pueden guardar tal cual en BD), más el healthUserId.
 * @property {string} access_token
 * @property {string} refresh_token
 * @property {number} expiry_date        ms epoch
 * @property {string} scope              scopes concedidos separados por espacio
 * @property {string} [token_type]
 * @property {number} [refresh_token_expires_in]  Solo si la app OAuth está en modo "Testing" (7 días).
 * @property {string} [healthUserId]     Identifica al usuario en los webhooks.
 */

/**
 * Flujo OAuth2 (authorization code) para conectar la cuenta de Google de un usuario.
 * API: getAuthUrl → redirigir al usuario → callback con ?code&state → exchangeCode.
 */
export class GoogleHealthAuth {
  /**
   * @param {object} options
   * @param {string} options.clientId
   * @param {string} options.clientSecret
   * @param {string} options.redirectUri  Debe estar dado de alta en el cliente OAuth de Google Cloud.
   */
  constructor({ clientId, clientSecret, redirectUri }) {
    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error('clientId, clientSecret y redirectUri son obligatorios');
    }
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
  }

  /** Lee un client_secret.json descargado de Google Cloud (tipo "installed" o "web"). */
  static fromClientSecretJson(json, redirectUri) {
    const cfg = json.web ?? json.installed;
    if (!cfg) throw new Error('client_secret.json no tiene la sección "web" ni "installed"');
    return new GoogleHealthAuth({
      clientId: cfg.client_id,
      clientSecret: cfg.client_secret,
      redirectUri: redirectUri ?? cfg.redirect_uris?.[0],
    });
  }

  #client() {
    return new OAuth2Client({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      redirectUri: this.redirectUri,
    });
  }

  /**
   * URL de consentimiento a la que mandar al usuario.
   * @param {object} [options]
   * @param {string} [options.state]  Valor aleatorio ligado a la sesión del usuario (anti-CSRF);
   *   comprobarlo en el callback.
   * @param {string[]} [options.scopes]
   */
  getAuthUrl({ state, scopes = DEFAULT_SCOPES } = {}) {
    return this.#client().generateAuthUrl({
      access_type: 'offline', // para recibir refresh_token
      prompt: 'consent', // fuerza refresh_token también en re-autorizaciones
      include_granted_scopes: true,
      scope: [...scopes],
      state,
    });
  }

  /**
   * Intercambia el `code` del callback por tokens y añade el healthUserId.
   * @returns {Promise<GoogleHealthCredentials>}
   */
  async exchangeCode(code) {
    const client = this.#client();
    try {
      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);
      const { data } = await client.request({ url: `${API_URL}/users/me/identity` });
      return { ...tokens, healthUserId: data.healthUserId ?? null };
    } catch (error) {
      throw toGoogleHealthError(error);
    }
  }

  /** Revoca el acceso (desconectar la cuenta). */
  async revoke(credentials) {
    const token = credentials.refresh_token ?? credentials.access_token;
    try {
      await this.#client().revokeToken(token);
    } catch (error) {
      throw toGoogleHealthError(error);
    }
  }
}
