import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import { md5Upper, randomString } from './crypto.js';
import { XiaomiError, XiaomiErrorCode } from './errors.js';

const ACCOUNT_URL = 'https://account.xiaomi.com';
const STATE_VERSION = 1;
const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded' };
const ICK_DOMAINS = ['https://account.xiaomi.com/', 'https://xiaomi.com/'];
const TOKEN_DOMAINS = [
  'https://sts.api.io.mi.com/',
  'https://api.io.mi.com/',
  'https://account.xiaomi.com/',
  'https://io.mi.com/',
  'https://mi.com/',
];
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

export const LoginStatus = Object.freeze({
  CAPTCHA_REQUIRED: 'CAPTCHA_REQUIRED',
  EMAIL_CODE_REQUIRED: 'EMAIL_CODE_REQUIRED',
  AUTHENTICATED: 'AUTHENTICATED',
});

/**
 * @typedef {object} XiaomiCredentials
 * @property {string} userId
 * @property {string} serviceToken
 * @property {string} ssecurity
 * @property {string|null} cUserId
 * @property {string|null} passToken  Permite renovar el serviceToken sin captcha/2FA (refresh).
 * @property {string} obtainedAt      ISO date.
 *
 * @typedef {object} LoginResult
 * @property {'CAPTCHA_REQUIRED'|'EMAIL_CODE_REQUIRED'|'AUTHENTICATED'} status
 * @property {object} [state]  Estado serializable para el siguiente paso. Contiene cookies y el
 *   hash de la contraseña: guardarlo SOLO en servidor, con TTL corto. Nunca enviarlo al front.
 * @property {{ image: string, mimeType: string }} [captcha]  image es un data URL listo para <img src>.
 * @property {boolean} [captchaRetry]  true si el captcha anterior era incorrecto.
 * @property {XiaomiCredentials} [credentials]
 */

function stripPrefix(value) {
  return String(value).replace('&&&START&&&', '').trim();
}

function parseJson(data) {
  if (data !== null && typeof data === 'object') return data;
  return JSON.parse(stripPrefix(data));
}

function tryParseJson(data) {
  try {
    return parseJson(data);
  } catch {
    return null;
  }
}

/**
 * Sesión de login: cookie jar + identidad simulada del dispositivo.
 * Se puede serializar entre pasos (cada paso puede ser una petición HTTP distinta a la API).
 */
class LoginSession {
  constructor({ jar, agent, deviceId, data = {} }, timeout) {
    this.jar = jar;
    this.agent = agent;
    this.deviceId = deviceId;
    this.data = data;
    this.http = wrapper(
      axios.create({ jar, withCredentials: true, timeout, validateStatus: () => true }),
    );
  }

  static async create(timeout) {
    const agentId = randomString(13, 'A'.charCodeAt(0), 'E'.charCodeAt(0));
    const randomText = randomString(18, 'a'.charCodeAt(0), 'z'.charCodeAt(0));
    const session = new LoginSession(
      {
        jar: new CookieJar(),
        agent: `${randomText}-${agentId} APP/com.xiaomi.mihome APPV/10.5.201`,
        deviceId: randomString(6, 'a'.charCodeAt(0), 'z'.charCodeAt(0)),
      },
      timeout,
    );

    for (const domain of ['https://account.xiaomi.com/', 'https://account.mi.com/']) {
      await session.jar.setCookie('sdkVersion=accountsdk-18.8.15', domain);
      await session.jar.setCookie(`deviceId=${session.deviceId}`, domain);
    }
    return session;
  }

  static restore(state, expectedStep, timeout) {
    if (!state || state.v !== STATE_VERSION || !state.cookies) {
      throw new XiaomiError(XiaomiErrorCode.INVALID_LOGIN_STATE, 'Estado de login inválido');
    }
    if (expectedStep && state.step !== expectedStep) {
      throw new XiaomiError(
        XiaomiErrorCode.INVALID_LOGIN_STATE,
        `Paso de login inesperado: se esperaba "${expectedStep}" y el estado está en "${state.step}"`,
      );
    }
    return new LoginSession(
      {
        jar: CookieJar.deserializeSync(state.cookies),
        agent: state.agent,
        deviceId: state.deviceId,
        data: { ...state.data },
      },
      timeout,
    );
  }

  toState(step) {
    return {
      v: STATE_VERSION,
      step,
      agent: this.agent,
      deviceId: this.deviceId,
      data: this.data,
      cookies: this.jar.serializeSync(),
      updatedAt: new Date().toISOString(),
    };
  }

  get headers() {
    return { 'User-Agent': this.agent, ...FORM_HEADERS };
  }

  async getCookie(name, domains) {
    for (const domain of domains) {
      try {
        const cookie = (await this.jar.getCookies(domain)).find((c) => c.key === name);
        if (cookie) return cookie.value;
      } catch {
        // dominio no válido para el jar: se ignora
      }
    }
    return null;
  }
}

export class XiaomiAuth {
  /**
   * @param {object} [options]
   * @param {number} [options.timeout=30000]
   * @param {{ debug: Function }} [options.logger]  p. ej. un logger pino.
   */
  constructor({ timeout = 30000, logger } = {}) {
    this.timeout = timeout;
    this.logger = logger;
  }

  debug(obj, msg) {
    this.logger?.debug?.(obj, msg);
  }

  /**
   * Paso 1: usuario + contraseña.
   * @returns {Promise<LoginResult>}
   */
  async start({ username, password }) {
    if (!username || !password) {
      throw new XiaomiError(
        XiaomiErrorCode.INVALID_CREDENTIALS,
        'Usuario y contraseña son obligatorios',
      );
    }

    const session = await LoginSession.create(this.timeout);
    session.data.username = username;
    session.data.passwordHash = md5Upper(password);

    const response = await session.http.get(
      `${ACCOUNT_URL}/pass/serviceLogin?sid=xiaomiio&_json=true`,
      {
        headers: { ...session.headers, Cookie: `userId=${encodeURIComponent(username)}` },
      },
    );
    this.debug({ status: response.status }, 'xiaomi serviceLogin');

    const json = response.status === 200 ? tryParseJson(response.data) : null;
    if (!json?._sign) {
      throw new XiaomiError(
        XiaomiErrorCode.UNEXPECTED_RESPONSE,
        'Usuario Xiaomi inválido o login inicial fallido',
        { status: response.status },
      );
    }
    session.data.sign = json._sign;

    return this.#serviceLoginAuth2(session);
  }

  /**
   * Paso opcional: texto del captcha. Puede devolver otro CAPTCHA_REQUIRED si era incorrecto.
   * @returns {Promise<LoginResult>}
   */
  async submitCaptcha(state, captchaCode) {
    const session = LoginSession.restore(state, 'captcha', this.timeout);
    if (!captchaCode) {
      throw new XiaomiError(XiaomiErrorCode.INVALID_CAPTCHA, 'El captcha es obligatorio');
    }
    return this.#serviceLoginAuth2(session, captchaCode);
  }

  /**
   * Paso 2FA: código recibido por email. Si es incorrecto lanza INVALID_EMAIL_CODE
   * y se puede reintentar con el mismo state.
   * @returns {Promise<LoginResult>}
   */
  async submitEmailCode(state, code) {
    const session = LoginSession.restore(state, 'email_code', this.timeout);
    if (!code) {
      throw new XiaomiError(XiaomiErrorCode.INVALID_EMAIL_CODE, 'El código es obligatorio');
    }
    const { context } = session.data;

    const ick = (await session.getCookie('ick', ICK_DOMAINS)) || session.data.ick || '';

    const verifyResponse = await session.http.post(
      `${ACCOUNT_URL}/identity/auth/verifyEmail`,
      new URLSearchParams({ _flag: '8', ticket: code, trust: 'false', _json: 'true', ick }),
      {
        params: {
          _flag: '8',
          _json: 'true',
          sid: 'xiaomiio',
          context,
          mask: '0',
          _locale: 'en_US',
        },
        headers: session.headers,
        maxRedirects: 10,
      },
    );
    this.debug({ status: verifyResponse.status }, 'xiaomi verifyEmail');

    if (verifyResponse.status !== 200) {
      throw new XiaomiError(
        XiaomiErrorCode.UNEXPECTED_RESPONSE,
        `verifyEmail devolvió HTTP ${verifyResponse.status}`,
      );
    }

    const verifyJson = tryParseJson(verifyResponse.data);
    if (verifyJson && verifyJson.code !== undefined && verifyJson.code !== 0) {
      throw new XiaomiError(
        XiaomiErrorCode.INVALID_EMAIL_CODE,
        'Código de verificación incorrecto',
        {
          xiaomiCode: verifyJson.code,
          description: verifyJson.tips ?? verifyJson.desc ?? verifyJson.description,
        },
      );
    }

    const finishLocation = await this.#findFinishLocation(session, verifyResponse, verifyJson);
    await this.#completeTwoFactor(session, finishLocation);

    return { status: LoginStatus.AUTHENTICATED, credentials: await this.#credentials(session) };
  }

  /**
   * Renueva serviceToken/ssecurity usando userId + passToken (sin captcha ni 2FA).
   * Pensado para procesos en segundo plano. Si Xiaomi ya no acepta el passToken lanza
   * SESSION_EXPIRED y hay que repetir el login completo.
   * @param {XiaomiCredentials} credentials
   * @returns {Promise<XiaomiCredentials>}
   */
  async refresh(credentials) {
    if (!credentials?.userId || !credentials?.passToken) {
      throw new XiaomiError(
        XiaomiErrorCode.SESSION_EXPIRED,
        'No hay passToken para renovar la sesión; es necesario volver a hacer login',
      );
    }

    const session = await LoginSession.create(this.timeout);
    await session.jar.setCookie(`userId=${credentials.userId}`, `${ACCOUNT_URL}/`);
    await session.jar.setCookie(`passToken=${credentials.passToken}`, `${ACCOUNT_URL}/`);

    const response = await session.http.get(
      `${ACCOUNT_URL}/pass/serviceLogin?sid=xiaomiio&_json=true`,
      { headers: session.headers },
    );
    this.debug({ status: response.status }, 'xiaomi refresh serviceLogin');

    const json = response.status === 200 ? tryParseJson(response.data) : null;
    if (!json?.ssecurity || !json?.location) {
      throw new XiaomiError(
        XiaomiErrorCode.SESSION_EXPIRED,
        'Xiaomi no aceptó el passToken; es necesario volver a hacer login',
      );
    }

    this.#applyLoginJson(session, json);
    session.data.userId ??= credentials.userId;
    session.data.cUserId ??= credentials.cUserId;
    session.data.passToken ??= credentials.passToken;
    await this.#followLocation(session);

    return this.#credentials(session);
  }

  // ------------------------------------------------------------------
  // Pasos internos
  // ------------------------------------------------------------------

  async #serviceLoginAuth2(session, captchaCode = null) {
    const params = {
      sid: 'xiaomiio',
      hash: session.data.passwordHash,
      callback: 'https://sts.api.io.mi.com/sts',
      qs: '%3Fsid%3Dxiaomiio%26_json%3Dtrue',
      user: session.data.username,
      _sign: session.data.sign,
      _json: 'true',
    };
    if (captchaCode) params.captCode = captchaCode;

    const response = await session.http.post(`${ACCOUNT_URL}/pass/serviceLoginAuth2`, null, {
      params,
      maxRedirects: 0,
      headers: session.headers,
    });
    this.debug({ status: response.status }, 'xiaomi serviceLoginAuth2');

    const json = response.status === 200 ? tryParseJson(response.data) : null;
    if (!json) {
      throw new XiaomiError(XiaomiErrorCode.UNEXPECTED_RESPONSE, 'No se pudo iniciar sesión', {
        status: response.status,
      });
    }

    // Va antes que el captcha: si Xiaomi ya ha comprobado la contraseña y además pide otro captcha
    // para el siguiente intento, lo que hay que decir es que la contraseña está mal
    if (json.code === 70016) {
      throw new XiaomiError(
        XiaomiErrorCode.INVALID_CREDENTIALS,
        'Usuario o contraseña incorrectos',
      );
    }

    // Xiaomi suele pedir el captcha ANTES de comprobar la contraseña (code 87001 + captchaUrl)
    if (json.captchaUrl !== undefined && json.captchaUrl !== null) {
      const captcha = await this.#downloadCaptcha(session, json.captchaUrl);
      return {
        status: LoginStatus.CAPTCHA_REQUIRED,
        captcha,
        captchaRetry: Boolean(captchaCode),
        state: session.toState('captcha'),
      };
    }

    if (json.code === 87001) {
      throw new XiaomiError(XiaomiErrorCode.INVALID_CAPTCHA, 'CAPTCHA incorrecto');
    }

    // Login sin 2FA
    if (json.ssecurity && String(json.ssecurity).length > 4) {
      this.#applyLoginJson(session, json);
      if (session.data.location) await this.#followLocation(session);
      return { status: LoginStatus.AUTHENTICATED, credentials: await this.#credentials(session) };
    }

    // 2FA por email
    if (json.notificationUrl) {
      await this.#startTwoFactor(session, json.notificationUrl);
      return { status: LoginStatus.EMAIL_CODE_REQUIRED, state: session.toState('email_code') };
    }

    throw new XiaomiError(XiaomiErrorCode.UNEXPECTED_RESPONSE, 'Respuesta de login inesperada', {
      xiaomiCode: json.code,
      description: json.desc ?? json.description,
    });
  }

  async #downloadCaptcha(session, captchaUrl) {
    const url = captchaUrl.startsWith('/') ? ACCOUNT_URL + captchaUrl : captchaUrl;
    const response = await session.http.get(url, {
      responseType: 'arraybuffer',
      headers: { 'User-Agent': session.agent },
    });
    if (response.status !== 200) {
      throw new XiaomiError(XiaomiErrorCode.UNEXPECTED_RESPONSE, 'No se pudo descargar el CAPTCHA');
    }
    // Xiaomi a veces lo sirve como application/octet-stream: forzar un tipo de imagen para <img src>
    const contentType = String(response.headers['content-type'] ?? '').split(';')[0];
    const mimeType = contentType.startsWith('image/') ? contentType : 'image/jpeg';
    const base64 = Buffer.from(response.data).toString('base64');
    return { mimeType, image: `data:${mimeType};base64,${base64}` };
  }

  async #startTwoFactor(session, notificationUrl) {
    const headers = session.headers;

    const authStart = await session.http.get(notificationUrl, { headers, maxRedirects: 10 });
    this.debug({ status: authStart.status }, 'xiaomi 2FA authStart');

    const context = new URL(notificationUrl).searchParams.get('context');
    if (!context) {
      throw new XiaomiError(XiaomiErrorCode.UNEXPECTED_RESPONSE, 'No se encontró context para 2FA');
    }
    session.data.context = context;

    const identityList = await session.http.get(`${ACCOUNT_URL}/identity/list`, {
      params: { sid: 'xiaomiio', context, _locale: 'en_US' },
      headers,
    });
    this.debug({ status: identityList.status }, 'xiaomi 2FA identity/list');

    const ick = (await session.getCookie('ick', ICK_DOMAINS)) || '';
    session.data.ick = ick;

    const sendResponse = await session.http.post(
      `${ACCOUNT_URL}/identity/auth/sendEmailTicket`,
      new URLSearchParams({ retry: '0', icode: '', _json: 'true', ick }),
      {
        params: {
          _dc: Date.now().toString(),
          sid: 'xiaomiio',
          context,
          mask: '0',
          _locale: 'en_US',
        },
        headers,
      },
    );
    this.debug({ status: sendResponse.status }, 'xiaomi 2FA sendEmailTicket');

    if (sendResponse.status !== 200) {
      throw new XiaomiError(
        XiaomiErrorCode.UNEXPECTED_RESPONSE,
        `sendEmailTicket devolvió HTTP ${sendResponse.status}`,
      );
    }
  }

  async #findFinishLocation(session, verifyResponse, verifyJson) {
    let finishLocation = verifyJson?.location || verifyResponse.headers.location || null;

    if (!finishLocation && typeof verifyResponse.data === 'string') {
      const match = verifyResponse.data.match(
        /https:\/\/account\.xiaomi\.com\/identity\/result\/check\?[^"' ]+/,
      );
      if (match) finishLocation = match[0];
    }

    if (!finishLocation) {
      const resultCheck = await session.http.get(`${ACCOUNT_URL}/identity/result/check`, {
        params: { sid: 'xiaomiio', context: session.data.context, _locale: 'en_US' },
        headers: session.headers,
        maxRedirects: 0,
      });
      if (REDIRECT_STATUSES.includes(resultCheck.status) && resultCheck.headers.location) {
        finishLocation = resultCheck.headers.location;
      }
    }

    if (!finishLocation) {
      throw new XiaomiError(
        XiaomiErrorCode.UNEXPECTED_RESPONSE,
        'No se pudo determinar la URL de continuación después de verifyEmail',
      );
    }
    return finishLocation;
  }

  async #completeTwoFactor(session, finishLocation) {
    const headers = session.headers;

    let endUrl = finishLocation;
    if (finishLocation.includes('/identity/result/check')) {
      const resultResponse = await session.http.get(finishLocation, { headers, maxRedirects: 0 });
      endUrl = resultResponse.headers.location;
    }
    if (!endUrl) {
      throw new XiaomiError(
        XiaomiErrorCode.UNEXPECTED_RESPONSE,
        'No se encontró serviceLoginAuth2/end después del 2FA',
      );
    }
    if (endUrl.startsWith('/')) endUrl = ACCOUNT_URL + endUrl;

    // No seguir redirects: necesitamos la cabecera extension-pragma.
    let endResponse = await session.http.get(endUrl, { headers, maxRedirects: 0 });
    if (
      endResponse.status === 200 &&
      typeof endResponse.data === 'string' &&
      endResponse.data.includes('Xiaomi Account - Tips')
    ) {
      endResponse = await session.http.get(endUrl, { headers, maxRedirects: 0 });
    }

    const extensionPragma = endResponse.headers['extension-pragma'];
    if (extensionPragma) {
      try {
        const securityData =
          typeof extensionPragma === 'string' ? JSON.parse(extensionPragma) : extensionPragma;
        if (securityData.ssecurity) session.data.ssecurity = securityData.ssecurity;
      } catch (error) {
        this.debug({ err: error.message }, 'xiaomi extension-pragma no parseable');
      }
    }
    if (!session.data.ssecurity) {
      throw new XiaomiError(
        XiaomiErrorCode.UNEXPECTED_RESPONSE,
        'Auth2/end no devolvió ssecurity en extension-pragma',
      );
    }

    let stsUrl = endResponse.headers.location || null;
    if (!stsUrl && typeof endResponse.data === 'string') {
      const index = endResponse.data.indexOf('https://sts.api.io.mi.com/sts');
      if (index !== -1) {
        let end = endResponse.data.indexOf('"', index);
        if (end === -1) end = Math.min(index + 500, endResponse.data.length);
        stsUrl = endResponse.data.slice(index, end);
      }
    }
    if (!stsUrl) {
      throw new XiaomiError(
        XiaomiErrorCode.UNEXPECTED_RESPONSE,
        'Auth2/end no devolvió la URL STS',
      );
    }

    const stsResponse = await session.http.get(stsUrl, { headers, maxRedirects: 10 });
    if (stsResponse.status !== 200) {
      throw new XiaomiError(
        XiaomiErrorCode.UNEXPECTED_RESPONSE,
        `STS devolvió HTTP ${stsResponse.status}`,
      );
    }

    session.data.serviceToken = await session.getCookie('serviceToken', TOKEN_DOMAINS);
    if (!session.data.serviceToken) {
      throw new XiaomiError(
        XiaomiErrorCode.UNEXPECTED_RESPONSE,
        'El 2FA terminó correctamente, pero no se encontró serviceToken',
      );
    }

    session.data.userId ||= await session.getCookie('userId', TOKEN_DOMAINS);
    session.data.cUserId ||= await session.getCookie('cUserId', TOKEN_DOMAINS);
  }

  #applyLoginJson(session, json) {
    session.data.ssecurity = json.ssecurity;
    session.data.userId = json.userId ? String(json.userId) : null;
    session.data.cUserId = json.cUserId || null;
    session.data.passToken = json.passToken || null;
    session.data.location = json.location || null;
  }

  async #followLocation(session) {
    const { location } = session.data;
    const response = await session.http.get(location, {
      headers: session.headers,
      maxRedirects: 10,
    });
    this.debug({ status: response.status }, 'xiaomi location');

    if (response.status === 200) {
      session.data.serviceToken = await session.getCookie('serviceToken', [
        location,
        'https://sts.api.io.mi.com/',
        'https://api.io.mi.com/',
      ]);
    }
    if (!session.data.serviceToken) {
      throw new XiaomiError(XiaomiErrorCode.UNEXPECTED_RESPONSE, 'No se pudo obtener serviceToken');
    }
  }

  /** @returns {Promise<XiaomiCredentials>} */
  async #credentials(session) {
    const { data } = session;
    const passToken =
      data.passToken || (await session.getCookie('passToken', ['https://account.xiaomi.com/']));

    if (!data.userId || !data.serviceToken || !data.ssecurity) {
      throw new XiaomiError(
        XiaomiErrorCode.UNEXPECTED_RESPONSE,
        'Login completado pero faltan userId, serviceToken o ssecurity',
      );
    }

    return {
      userId: String(data.userId),
      serviceToken: data.serviceToken,
      ssecurity: data.ssecurity,
      cUserId: data.cUserId ?? null,
      passToken: passToken ?? null,
      obtainedAt: new Date().toISOString(),
    };
  }
}
