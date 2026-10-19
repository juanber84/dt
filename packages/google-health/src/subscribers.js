import { GoogleAuth } from 'google-auth-library';
import { API_URL } from './auth.js';
import { toGoogleHealthError } from './errors.js';
import { DATA_TYPES } from './data-types.js';

/** Tipos con soporte de webhook según el catálogo. */
export const WEBHOOK_DATA_TYPES = Object.freeze(
  DATA_TYPES.filter((d) => d.webhook).map((d) => d.id),
);

/**
 * Administración de suscriptores de webhooks (nivel proyecto de Google Cloud, NO de usuario).
 * Requiere una cuenta de servicio con rol "Google Health API Editor/Admin" y scope cloud-platform:
 * fichero de clave (keyFile) o Application Default Credentials.
 */
export class GoogleHealthSubscribers {
  /**
   * @param {object} options
   * @param {string} options.projectId  Número de proyecto de Google Cloud (recomendado por Google).
   * @param {string} [options.keyFile]  JSON de la cuenta de servicio. Sin él usa ADC.
   * @param {object} [options.authClient]  Cliente ya autenticado (tests).
   */
  constructor({ projectId, keyFile, authClient }) {
    if (!projectId) throw new Error('projectId es obligatorio');
    this.parent = `projects/${projectId}`;
    this.auth = authClient
      ? { getClient: async () => authClient }
      : new GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  }

  async #request(path, { method = 'GET', params, data } = {}) {
    try {
      const client = await this.auth.getClient();
      const response = await client.request({ url: `${API_URL}/${path}`, method, params, data });
      return response.data;
    } catch (error) {
      throw toGoogleHealthError(error);
    }
  }

  /**
   * Crea el suscriptor. Google verificará el endpoint en el acto (tiene que estar desplegado).
   * @param {object} options
   * @param {string} options.subscriberId  4-36 caracteres: [a-z][a-z0-9-]{2,34}[a-z0-9]
   * @param {string} options.endpointUri   HTTPS público
   * @param {string} options.secret        Valor completo de la cabecera Authorization, p. ej. "Bearer xxx"
   * @param {string[]} [options.dataTypes]
   * @param {'AUTOMATIC'|'MANUAL'} [options.policy='AUTOMATIC']  AUTOMATIC: todos los usuarios que
   *   autoricen la app quedan suscritos sin hacer nada más.
   */
  create({
    subscriberId,
    endpointUri,
    secret,
    dataTypes = WEBHOOK_DATA_TYPES,
    policy = 'AUTOMATIC',
  }) {
    return this.#request(`${this.parent}/subscribers`, {
      method: 'POST',
      params: { subscriberId },
      data: {
        endpointUri,
        endpointAuthorization: { secret },
        subscriberConfigs: [{ dataTypes, subscriptionCreatePolicy: policy }],
      },
    });
  }

  async list() {
    const items = [];
    let pageToken;
    do {
      const page = await this.#request(`${this.parent}/subscribers`, { params: { pageToken } });
      items.push(...(page.subscribers ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return items;
  }

  /** @param {object} changes  Campos de Subscriber a cambiar (endpointUri, endpointAuthorization, subscriberConfigs) */
  update(subscriberId, changes) {
    return this.#request(`${this.parent}/subscribers/${subscriberId}`, {
      method: 'PATCH',
      params: { updateMask: Object.keys(changes).join(',') },
      data: changes,
    });
  }

  delete(subscriberId, { force = false } = {}) {
    return this.#request(`${this.parent}/subscribers/${subscriberId}`, {
      method: 'DELETE',
      params: { force },
    });
  }

  // Suscripciones por usuario: solo para tipos configurados como MANUAL

  createSubscription(subscriberId, { subscriptionId, healthUserId, dataTypes }) {
    return this.#request(`${this.parent}/subscribers/${subscriberId}/subscriptions`, {
      method: 'POST',
      params: { subscriptionId },
      data: { user: `users/${healthUserId}`, dataTypes },
    });
  }

  async listSubscriptions(subscriberId, { filter } = {}) {
    const items = [];
    let pageToken;
    do {
      const page = await this.#request(`${this.parent}/subscribers/${subscriberId}/subscriptions`, {
        params: { pageToken, filter },
      });
      items.push(...(page.subscriptions ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return items;
  }

  deleteSubscription(subscriberId, subscriptionId) {
    return this.#request(
      `${this.parent}/subscribers/${subscriberId}/subscriptions/${subscriptionId}`,
      {
        method: 'DELETE',
      },
    );
  }
}
