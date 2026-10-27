import { randomUUID } from 'node:crypto';
import {
  XiaomiAuth,
  XiaomiCloudClient,
  XiaomiError,
  LoginStatus,
  getScales,
} from '@digitaltwin/xiaomi';
import { HttpError } from '../utils/http-error.js';
import { publicConnection } from '@digitaltwin/connections';

/**
 * Login de Xiaomi por pasos desde el front: usuario y contraseña → captcha → código por email.
 *
 * Entre paso y paso el estado de Xiaomi (cookies y hash de la contraseña) se queda aquí, en
 * memoria y como mucho `ttlMs`; al front solo le llega un `loginId`. La contraseña no se guarda y
 * las imágenes del captcha se reenvían tal cual, sin guardarlas. Al terminar se guarda la conexión
 * con el usuario y el token.
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/connections').createMemoryConnectionStore>} deps.store
 * @param {Pick<XiaomiAuth, 'start' | 'submitCaptcha' | 'submitEmailCode'>} [deps.auth]
 * @param {(credentials: object, region: string) => Promise<object>} [deps.describeAccount]
 *   Datos de la cuenta para enseñar en el front (las básculas). Si falla, se conecta igual.
 * @param {number} [deps.ttlMs]
 * @param {() => number} [deps.now]
 * @param {(userId: string, provider: string) => Promise<void>} [deps.onConnected]
 *   Recién conectado (con BD: encola la carga inicial del histórico).
 * @param {import('pino').Logger} [deps.logger]
 */
export function createXiaomiLogin({
  store,
  onConnected,
  auth = new XiaomiAuth(),
  describeAccount = describeScales,
  ttlMs = 10 * 60_000,
  now = Date.now,
  logger,
}) {
  const pending = new Map();

  function take(loginId, step, userId) {
    for (const [id, login] of pending) if (login.expiresAt <= now()) pending.delete(id);
    const login = pending.get(loginId);
    // El loginId de otro usuario se trata como si no existiera
    if (!login || login.state.step !== step || login.userId !== userId) {
      throw new HttpError(410, 'El inicio de sesión ha caducado: vuelve a empezar', {
        code: 'LOGIN_EXPIRED',
      });
    }
    return login;
  }

  async function advance(loginId, login, call) {
    let result;
    try {
      result = await call();
    } catch (err) {
      // Solo el código del email se puede repetir con el mismo estado; lo demás empieza de cero
      if (err?.code !== 'INVALID_EMAIL_CODE') pending.delete(loginId);
      throw toHttpError(err, logger);
    }

    if (result.status === LoginStatus.AUTHENTICATED) {
      pending.delete(loginId);
      return { status: 'CONNECTED', connection: await finish(login, result.credentials) };
    }

    pending.set(loginId, { ...login, state: result.state, expiresAt: now() + ttlMs });
    return {
      status: result.status,
      loginId,
      ...(result.captcha && { captcha: result.captcha.image, captchaRetry: result.captchaRetry }),
    };
  }

  async function finish({ userId, username, region }, credentials) {
    let details = {};
    try {
      details = await describeAccount(credentials, region);
    } catch (err) {
      logger?.warn({ err }, 'Xiaomi conectado, pero no se pudieron leer los dispositivos');
    }
    // Al reconectar se conserva lo sincronizado: la siguiente sincronización sigue donde iba
    const previous = await store.get(userId, 'xiaomi');
    const connection = await store.save({
      ...(previous && {
        lastSync: previous.lastSync,
        records: previous.records,
        firstRecordAt: previous.firstRecordAt,
        lastRecord: previous.lastRecord,
      }),
      userId,
      provider: 'xiaomi',
      status: 'connected',
      account: username,
      region,
      connectedAt: new Date(now()).toISOString(),
      details,
      credentials,
    });
    logger?.info({ region, devices: details.devices?.length }, 'Xiaomi conectado');
    try {
      await onConnected?.(userId, 'xiaomi');
    } catch (err) {
      logger?.error({ err }, 'No se pudo encolar la carga inicial de Xiaomi');
    }
    return publicConnection(connection);
  }

  return {
    /** @param {{ userId: string, username: string, password: string, region: string }} input */
    start({ userId, username, password, region }) {
      const loginId = randomUUID();
      return advance(loginId, { userId, username, region }, () =>
        auth.start({ username, password }),
      );
    },
    submitCaptcha(userId, loginId, code) {
      const login = take(loginId, 'captcha', userId);
      return advance(loginId, login, () => auth.submitCaptcha(login.state, code));
    },
    submitEmailCode(userId, loginId, code) {
      const login = take(loginId, 'email_code', userId);
      return advance(loginId, login, () => auth.submitEmailCode(login.state, code));
    },
  };
}

async function describeScales(credentials, region) {
  const client = new XiaomiCloudClient({ credentials, region, autoRefresh: false });
  const scales = await getScales(client);
  return { devices: scales.map(({ name, model }) => ({ name: name ?? model, model })) };
}

const MESSAGES = {
  INVALID_CREDENTIALS: 'Usuario o contraseña incorrectos',
  INVALID_CAPTCHA: 'El texto de la imagen no es correcto',
  INVALID_EMAIL_CODE: 'El código no es correcto',
};

function toHttpError(err, logger) {
  if (err instanceof HttpError) return err;
  if (err instanceof XiaomiError && MESSAGES[err.code]) {
    return new HttpError(422, MESSAGES[err.code], { code: err.code });
  }
  if (err instanceof XiaomiError && err.code === 'INVALID_LOGIN_STATE') {
    return new HttpError(410, 'El inicio de sesión ha caducado: vuelve a empezar', {
      code: 'LOGIN_EXPIRED',
    });
  }
  logger?.warn({ err }, 'Fallo en el login de Xiaomi');
  return new HttpError(502, `No se ha podido iniciar sesión: ${err.message}`, {
    code: 'XIAOMI_ERROR',
  });
}
