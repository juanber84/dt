import axios from 'axios';
import { buildEncryptedForm, decryptValue } from './crypto.js';
import { XiaomiError, XiaomiErrorCode } from './errors.js';
import { XiaomiAuth } from './auth.js';

export const REGIONS = Object.freeze(['cn', 'de', 'us', 'ru', 'tw', 'sg', 'in', 'i2']);

export function apiBaseUrl(region) {
  return region === 'cn' ? 'https://api.io.mi.com/app' : `https://${region}.api.io.mi.com/app`;
}

/**
 * Cliente para la API cifrada (RC4) de Xiaomi Cloud usando credenciales ya obtenidas.
 * No guarda estado entre llamadas: se puede crear uno por ejecución del proceso.
 */
export class XiaomiCloudClient {
  /**
   * @param {object} options
   * @param {import('./auth.js').XiaomiCredentials} options.credentials
   * @param {string} [options.region='de']
   * @param {number} [options.timeout=30000]
   * @param {{ debug: Function }} [options.logger]
   * @param {import('axios').AxiosInstance} [options.http]
   * @param {boolean} [options.autoRefresh=true]  Si la sesión caduca, renueva con passToken y reintenta.
   * @param {(credentials: import('./auth.js').XiaomiCredentials) => (void|Promise<void>)} [options.onCredentialsRefreshed]
   *   Se llama con las credenciales nuevas tras una renovación: aquí se guardan en BD.
   * @param {XiaomiAuth} [options.auth]
   */
  constructor({
    credentials,
    region = 'de',
    timeout = 30000,
    logger,
    http,
    autoRefresh = true,
    onCredentialsRefreshed,
    auth,
  } = {}) {
    const { userId, serviceToken, ssecurity } = credentials ?? {};
    if (!userId || !serviceToken || !ssecurity) {
      throw new XiaomiError(
        XiaomiErrorCode.SESSION_EXPIRED,
        'Las credenciales deben contener userId, serviceToken y ssecurity',
      );
    }
    if (!REGIONS.includes(region)) {
      throw new Error(`Región Xiaomi inválida: "${region}". Valores: ${REGIONS.join(', ')}`);
    }

    this.credentials = credentials;
    this.region = region;
    this.logger = logger;
    this.http = http ?? axios.create({ timeout, validateStatus: () => true });
    this.autoRefresh = autoRefresh;
    this.onCredentialsRefreshed = onCredentialsRefreshed;
    this.auth = auth ?? new XiaomiAuth({ timeout, logger });
    this.refreshing = null;
  }

  /** Renueva serviceToken/ssecurity con passToken y notifica para persistir. */
  async refreshCredentials() {
    // Si varias llamadas caducan a la vez, solo se renueva una vez.
    this.refreshing ??= (async () => {
      try {
        this.credentials = await this.auth.refresh(this.credentials);
        await this.onCredentialsRefreshed?.(this.credentials);
        return this.credentials;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /**
   * Llamada firmada y cifrada. Devuelve `result` de la respuesta descifrada.
   * @param {string} path  Ruta relativa a /app, p. ej. '/eco/common/scale/getUserDataByPage'.
   * @param {object} payload
   * @param {Record<string,string>} [headers]
   */
  async request(path, payload, headers = {}) {
    try {
      return await this.#send(path, payload, headers);
    } catch (error) {
      if (!this.autoRefresh || error.code !== XiaomiErrorCode.SESSION_EXPIRED) throw error;
      this.logger?.debug?.({ path }, 'xiaomi sesión caducada, renovando');
      await this.refreshCredentials();
      return this.#send(path, payload, headers);
    }
  }

  async #send(path, payload, headers) {
    const { userId, serviceToken, ssecurity } = this.credentials;
    const url = apiBaseUrl(this.region) + path;
    const { form, signedNonce } = buildEncryptedForm(ssecurity, path, JSON.stringify(payload));

    const body = new URLSearchParams();
    for (const key of ['data', 'rc4_hash__', 'signature', '_nonce']) body.set(key, form[key]);

    const response = await this.http.post(url, body.toString(), {
      responseType: 'text',
      transformResponse: [(data) => data],
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: [
          `userId=${userId}`,
          `serviceToken=${serviceToken}`,
          `yetAnotherServiceToken=${serviceToken}`,
        ].join('; '),
        ...headers,
      },
    });
    this.logger?.debug?.({ url, status: response.status }, 'xiaomi api');

    if (response.status === 401 || response.status === 403) {
      throw new XiaomiError(
        XiaomiErrorCode.SESSION_EXPIRED,
        `Sesión de Xiaomi caducada o no válida (HTTP ${response.status})`,
      );
    }
    if (response.status !== 200) {
      throw new XiaomiError(XiaomiErrorCode.API_ERROR, `Xiaomi Cloud HTTP ${response.status}`, {
        status: response.status,
        body: String(response.data).slice(0, 500),
      });
    }

    const plaintext = decryptValue(signedNonce, response.data);
    let json;
    try {
      json = JSON.parse(plaintext);
    } catch {
      throw new XiaomiError(
        XiaomiErrorCode.UNEXPECTED_RESPONSE,
        'La respuesta descifrada de Xiaomi no es JSON',
        { body: plaintext.slice(0, 500) },
      );
    }

    if (json.code !== undefined && json.code !== 0) {
      throw new XiaomiError(
        XiaomiErrorCode.API_ERROR,
        `Xiaomi API code=${json.code}: ${json.message || ''}`,
        { xiaomiCode: json.code },
      );
    }

    return json.result;
  }
}
