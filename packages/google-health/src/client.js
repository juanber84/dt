import { OAuth2Client } from 'google-auth-library';
import { API_URL } from './auth.js';
import { toGoogleHealthError } from './errors.js';

/**
 * Cliente autenticado de la Google Health API para un usuario.
 * Refresca el access token automáticamente; cuando lo hace llama a `onCredentialsRefreshed`
 * con las credenciales completas para que se guarden en BD.
 */
export class GoogleHealthClient {
  /**
   * @param {object} options
   * @param {import('./auth.js').GoogleHealthCredentials} options.credentials
   * @param {string} options.clientId
   * @param {string} options.clientSecret
   * @param {(credentials: import('./auth.js').GoogleHealthCredentials) => (void|Promise<void>)} [options.onCredentialsRefreshed]
   * @param {{ debug?: Function, error?: Function }} [options.logger]
   */
  constructor({ credentials, clientId, clientSecret, onCredentialsRefreshed, logger }) {
    if (!credentials?.refresh_token && !credentials?.access_token) {
      throw new Error('Las credenciales deben tener refresh_token o access_token');
    }
    this.credentials = { ...credentials };
    this.logger = logger;
    this.pendingSave = Promise.resolve();

    this.oauth = new OAuth2Client({ clientId, clientSecret });
    this.oauth.setCredentials(this.credentials);
    this.oauth.on('tokens', (tokens) => {
      // Google no siempre reenvía el refresh_token: se conserva el anterior
      this.credentials = { ...this.credentials, ...tokens };
      this.logger?.debug?.({ expiry: tokens.expiry_date }, 'google-health token renovado');
      if (onCredentialsRefreshed) {
        const snapshot = { ...this.credentials };
        this.pendingSave = this.pendingSave
          .then(() => onCredentialsRefreshed(snapshot))
          .catch((err) => this.logger?.error?.({ err }, 'onCredentialsRefreshed falló'));
      }
    });
  }

  /**
   * Petición a la API (ruta relativa a /v4).
   * @param {string} path  p. ej. '/users/me/identity'
   * @param {{ method?: string, params?: object, data?: object }} [options]
   */
  async request(path, { method = 'GET', params, data } = {}) {
    try {
      const response = await this.oauth.request({
        url: `${API_URL}${path}`,
        method,
        params,
        data,
        retry: true,
      });
      return response.data;
    } catch (error) {
      throw toGoogleHealthError(error);
    } finally {
      await this.pendingSave;
    }
  }

  getIdentity() {
    return this.request('/users/me/identity');
  }

  getProfile() {
    return this.request('/users/me/profile');
  }

  getSettings() {
    return this.request('/users/me/settings');
  }

  async listPairedDevices() {
    const items = [];
    let pageToken;
    do {
      const page = await this.request('/users/me/pairedDevices', { params: { pageToken } });
      items.push(...(page.pairedDevices ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return items;
  }
}
