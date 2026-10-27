import { GoogleAuth } from 'google-auth-library';
import { API_URL } from './auth.js';
import { GoogleHealthErrorCode, toGoogleHealthError } from './errors.js';
import { DATA_TYPES } from './data-types.js';
import { toAuthorization } from './webhooks.js';

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
   * @param {object} [options.credentials]  El mismo JSON ya leído (p. ej. de un secreto).
   * @param {object} [options.authClient]  Cliente ya autenticado (tests).
   */
  constructor({ projectId, keyFile, credentials, authClient }) {
    if (!projectId) throw new Error('projectId es obligatorio');
    this.parent = `projects/${projectId}`;
    this.auth = authClient
      ? { getClient: async () => authClient }
      : new GoogleAuth({
          keyFile,
          credentials,
          scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        });
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
   * @param {string} options.secret        Clave del webhook, con o sin "Bearer " delante
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
        endpointAuthorization: { secret: toAuthorization(secret) },
        subscriberConfigs: [{ dataTypes, subscriptionCreatePolicy: policy }],
      },
    });
  }

  /**
   * Deja el suscriptor como se pide: lo crea si no existe y lo actualiza si algo no cuadra. Google
   * no devuelve el secreto, así que un cambio de secreto solo se aplica con `force`.
   * @param {Parameters<GoogleHealthSubscribers['create']>[0] & { force?: boolean }} options
   * @returns {Promise<{ action: 'created'|'updated'|'unchanged', subscriber: object }>}
   */
  async ensure({
    subscriberId,
    endpointUri,
    secret,
    dataTypes = WEBHOOK_DATA_TYPES,
    policy = 'AUTOMATIC',
    force = false,
  }) {
    const current = (await this.list()).find((s) =>
      s.name?.endsWith(`/subscribers/${subscriberId}`),
    );
    if (!current) {
      const subscriber = await this.create({
        subscriberId,
        endpointUri,
        secret,
        dataTypes,
        policy,
      });
      return { action: 'created', subscriber };
    }

    const [config] = current.subscriberConfigs ?? [];
    const sameTypes = [...(config?.dataTypes ?? [])].sort().join() === [...dataTypes].sort().join();
    const ok =
      current.endpointUri === endpointUri &&
      current.state === 'ACTIVE' &&
      current.endpointAuthorization?.secretSet &&
      current.subscriberConfigs?.length === 1 &&
      config.subscriptionCreatePolicy === policy &&
      sameTypes;
    if (ok && !force) return { action: 'unchanged', subscriber: current };

    const subscriber = await this.update(subscriberId, {
      endpointUri,
      endpointAuthorization: { secret: toAuthorization(secret) },
      subscriberConfigs: [{ dataTypes, subscriptionCreatePolicy: policy }],
    });
    return { action: 'updated', subscriber };
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

  /**
   * Intentos de entrega de avisos desde `since`, de Cloud Logging (la cuenta de servicio necesita
   * el rol Visor de registros). Cada uno con su hora y el código que le dimos.
   * @returns {Promise<Array<{ at: string, status: number|null, subscriber: string|null }>>}
   */
  async deliveries({ since }) {
    const client = await this.auth.getClient();
    const entries = [];
    let pageToken;
    do {
      const { data } = await client
        .request({
          url: 'https://logging.googleapis.com/v2/entries:list',
          method: 'POST',
          data: {
            resourceNames: [this.parent],
            orderBy: 'timestamp asc',
            pageSize: 1000,
            pageToken,
            filter: `resource.type="health.googleapis.com/Subscriber" AND logName:"webhook_notification" AND timestamp >= "${new Date(since).toISOString()}"`,
          },
        })
        .catch((error) => {
          throw toGoogleHealthError(error);
        });
      entries.push(...(data.entries ?? []));
      pageToken = data.nextPageToken;
    } while (pageToken && entries.length < 10_000);
    return entries.map((e) => ({
      at: e.timestamp,
      status: e.jsonPayload?.httpResponse?.status ?? null,
      subscriber: e.resource?.labels?.subscriber_id ?? null,
    }));
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

  updateSubscription(subscriberId, subscriptionId, { dataTypes }) {
    return this.#request(
      `${this.parent}/subscribers/${subscriberId}/subscriptions/${subscriptionId}`,
      {
        method: 'PATCH',
        params: { updateMask: 'dataTypes' },
        data: { dataTypes },
      },
    );
  }

  /**
   * Deja las suscripciones (MANUAL) del suscriptor como `wanted`: crea las que faltan, corrige los
   * tipos de las que han cambiado y borra las de usuarios que ya no están. Las que Google niega
   * (403: el consentimiento del usuario no vale para el proyecto) van en `denied`.
   * @param {string} subscriberId
   * @param {Array<{ subscriptionId: string, healthUserId: string, dataTypes: string[] }>} wanted
   * @returns {Promise<{ created: number, updated: number, deleted: number, unchanged: number, denied: string[] }>}
   */
  async ensureSubscriptions(subscriberId, wanted) {
    const idOf = (s) => s.name?.split('/subscriptions/')[1];
    const existing = new Map((await this.listSubscriptions(subscriberId)).map((s) => [idOf(s), s]));
    const result = { created: 0, updated: 0, deleted: 0, unchanged: 0, denied: [] };
    // Google los devuelve con el nombre entero ("users/123/dataTypes/steps") desde el 27-10-2026,
    // y antes como "steps": se comparan por lo de detrás de "/dataTypes/"
    const short = (t) => t.split('/dataTypes/').pop();
    const same = (a = [], b = []) =>
      [...a].map(short).sort().join() === [...b].map(short).sort().join();

    for (const want of wanted) {
      const current = existing.get(want.subscriptionId);
      existing.delete(want.subscriptionId);
      if (!current) {
        if (await this.#createOrDeny(subscriberId, want, result)) result.created++;
      } else if (current.user !== `users/${want.healthUserId}`) {
        // El usuario no se puede cambiar: se rehace
        await this.deleteSubscription(subscriberId, want.subscriptionId);
        if (await this.#createOrDeny(subscriberId, want, result)) result.updated++;
      } else if (!same(current.dataTypes, want.dataTypes)) {
        try {
          await this.updateSubscription(subscriberId, want.subscriptionId, want);
        } catch (error) {
          // Google rechazó el PATCH de los tipos (400) el 27-10-2026: se rehace, como al cambiar
          // de usuario
          if (error.code !== GoogleHealthErrorCode.INVALID_REQUEST) throw error;
          await this.deleteSubscription(subscriberId, want.subscriptionId);
          if (!(await this.#createOrDeny(subscriberId, want, result))) continue;
        }
        result.updated++;
      } else {
        result.unchanged++;
      }
    }
    for (const id of existing.keys()) {
      await this.deleteSubscription(subscriberId, id);
      result.deleted++;
    }
    return result;
  }

  /**
   * Google niega la suscripción (403) de un usuario cuyo consentimiento ya no vale para el proyecto
   * aunque su token siga leyendo: se apunta y se sigue con los demás, en vez de fallar todo.
   */
  async #createOrDeny(subscriberId, want, result) {
    try {
      await this.createSubscription(subscriberId, want);
      return true;
    } catch (error) {
      if (error.code !== GoogleHealthErrorCode.PERMISSION_DENIED) throw error;
      result.denied.push(want.subscriptionId);
      return false;
    }
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
