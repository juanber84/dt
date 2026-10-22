/**
 * Cliente de Motra (app de entrenos de fuerza). No tiene API pública: se habla con su mismo
 * backend REST (`backend.motra.com`), que usa Firebase Auth. Al conectar se hace login una vez con
 * email y contraseña (`signInWithPassword`) y solo se guarda el refresh token de Firebase (no la
 * contraseña). Con él se saca un idToken (~1 h) que va como `Authorization: Bearer` en cada
 * llamada. El App Check (DeviceCheck de iOS) no se exige en las lecturas, así que basta el Bearer.
 * La API key de Firebase es pública (va dentro de la app), no es un secreto.
 */
export const MotraErrorCode = Object.freeze({
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  API_ERROR: 'API_ERROR',
});

export class MotraError extends Error {
  /**
   * @param {keyof typeof MotraErrorCode} code
   * @param {string} message
   * @param {{ status?: number, retryAfterSeconds?: number }} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MotraError';
    this.code = code;
    Object.assign(this, details);
  }
}

const BACKEND_URL = 'https://backend.motra.com';
const IDENTITY_URL = 'https://identitytoolkit.googleapis.com/v1';
const SECURE_TOKEN_URL = 'https://securetoken.googleapis.com/v1';
// API key de Firebase de la app de Motra (proyecto train-165d3): pública, va dentro de la app
export const DEFAULT_FIREBASE_API_KEY = 'AIzaSyADtP9ZTyPUIqk7T9xHvEuEXhe--IYYLWw';

// Errores de Firebase (el `error.message` del 400) que quieren decir "email o contraseña mal"...
const BAD_LOGIN = [
  'EMAIL_NOT_FOUND',
  'INVALID_PASSWORD',
  'INVALID_LOGIN_CREDENTIALS',
  'INVALID_EMAIL',
  'USER_DISABLED',
  'MISSING_PASSWORD',
];
// ...y "la sesión ya no vale" (contraseña cambiada, cuenta borrada o desactivada): hay que reconectar
const DEAD_SESSION = [
  'TOKEN_EXPIRED',
  'INVALID_REFRESH_TOKEN',
  'USER_DISABLED',
  'USER_NOT_FOUND',
  'INVALID_GRANT_TYPE',
  'MISSING_REFRESH_TOKEN',
];

async function firebaseCall(fetch, url, init, { timeoutMs, onBadRequest }) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new MotraError(
      MotraErrorCode.API_ERROR,
      `No se pudo hablar con Firebase: ${err.message}`,
    );
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 400) {
    // A veces trae detalle detrás: "TOO_MANY_ATTEMPTS_TRY_LATER : ..."
    const reason = String(body?.error?.message ?? '').split(' ')[0];
    onBadRequest(reason);
    throw new MotraError(MotraErrorCode.API_ERROR, `Firebase: ${reason || 'error 400'}`, {
      status: 400,
    });
  }
  if (res.status === 429) {
    throw new MotraError(MotraErrorCode.RATE_LIMITED, 'Firebase pide esperar', {
      status: 429,
      retryAfterSeconds: Number(res.headers.get('retry-after')) || 60,
    });
  }
  if (!res.ok) {
    throw new MotraError(MotraErrorCode.API_ERROR, `Firebase ${res.status}`, {
      status: res.status,
    });
  }
  return body;
}

/**
 * Login con email y contraseña (solo al conectar). Devuelve el refresh token que hay que guardar
 * y el id de la cuenta.
 * @param {object} options
 * @param {string} options.email
 * @param {string} options.password
 * @param {string} [options.apiKey]
 * @param {typeof fetch} [options.fetch]
 * @param {string} [options.identityUrl]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ refreshToken: string, idToken: string, accountId: string, email: string }>}
 */
export async function signInWithPassword({
  email,
  password,
  apiKey = DEFAULT_FIREBASE_API_KEY,
  fetch = globalThis.fetch,
  identityUrl = IDENTITY_URL,
  timeoutMs = 30_000,
}) {
  const body = await firebaseCall(
    fetch,
    `${identityUrl}/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
    {
      timeoutMs,
      onBadRequest(reason) {
        if (BAD_LOGIN.includes(reason)) {
          throw new MotraError(
            MotraErrorCode.INVALID_CREDENTIALS,
            'Motra no acepta ese email o contraseña',
            { status: 400 },
          );
        }
      },
    },
  );
  return {
    refreshToken: body.refreshToken,
    idToken: body.idToken,
    accountId: body.localId,
    email: body.email ?? email,
  };
}

/**
 * Cliente de lectura con el refresh token guardado.
 * @param {object} options
 * @param {string} options.refreshToken
 * @param {(refreshToken: string) => Promise<void>|void} [options.onRefreshToken]
 *   Firebase puede rotar el refresh token: se avisa para guardar el nuevo.
 * @param {string} [options.apiKey]
 * @param {typeof fetch} [options.fetch]
 * @param {string} [options.backendUrl]
 * @param {string} [options.secureTokenUrl]
 * @param {number} [options.timeoutMs]
 */
export function createMotraClient({
  refreshToken,
  onRefreshToken,
  apiKey = DEFAULT_FIREBASE_API_KEY,
  fetch = globalThis.fetch,
  backendUrl = BACKEND_URL,
  secureTokenUrl = SECURE_TOKEN_URL,
  timeoutMs = 30_000,
}) {
  let currentRefresh = refreshToken;
  /** @type {string|null} */
  let idToken = null;

  async function renew() {
    const body = await firebaseCall(
      fetch,
      `${secureTokenUrl}/token?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: currentRefresh,
        }).toString(),
      },
      {
        timeoutMs,
        onBadRequest(reason) {
          if (DEAD_SESSION.includes(reason)) {
            throw new MotraError(MotraErrorCode.SESSION_EXPIRED, 'La sesión de Motra ha caducado', {
              status: 400,
            });
          }
        },
      },
    );
    idToken = body.id_token;
    if (body.refresh_token && body.refresh_token !== currentRefresh) {
      currentRefresh = body.refresh_token;
      await onRefreshToken?.(currentRefresh);
    }
  }

  async function get(path, params = {}) {
    if (!idToken) await renew();
    const query = new URLSearchParams(params).toString();
    const url = `${backendUrl}${path}${query ? `?${query}` : ''}`;
    const call = () =>
      fetch(url, {
        headers: { Authorization: `Bearer ${idToken}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });

    let res = await call();
    // El idToken dura ~1 h: en una carga larga puede caducar a mitad. Se renueva una vez.
    if (res.status === 401) {
      await renew();
      res = await call();
    }
    if (res.status === 401 || res.status === 403) {
      throw new MotraError(MotraErrorCode.SESSION_EXPIRED, 'Motra rechaza la sesión', {
        status: res.status,
      });
    }
    if (res.status === 429) {
      throw new MotraError(MotraErrorCode.RATE_LIMITED, 'Motra pide esperar', {
        status: 429,
        retryAfterSeconds: Number(res.headers.get('retry-after')) || 60,
      });
    }
    if (!res.ok) {
      throw new MotraError(MotraErrorCode.API_ERROR, `Motra ${res.status}`, { status: res.status });
    }
    const body = await res.json();
    if (body?.success === false) {
      throw new MotraError(MotraErrorCode.API_ERROR, 'Motra responde sin éxito');
    }
    return body;
  }

  return {
    /**
     * Índice de entrenos que empiezan entre dos instantes (ms): { 'YYYY-MM-DD': [{ workoutID,
     * timeStarted, timeEnded, activityType, workoutFormat }] }. El backend los quiere en segundos.
     */
    async calendarWorkouts({ startMs, endMs }) {
      const body = await get('/user/calendar-workouts/v3', {
        startTimestamp: String(startMs / 1000),
        endTimestamp: String(endMs / 1000),
      });
      return body?.data ?? {};
    },

    /** El entreno completo: name, activities, setMap (reps/peso/descanso), exerciseDetails... */
    async workoutDetails(workoutId) {
      const body = await get(`/workout/${encodeURIComponent(workoutId)}/details`);
      return body?.data?.workout ?? null;
    },
  };
}

/** Los entrenos de un índice de calendar-workouts, sin repetir y por orden de inicio. */
export function flattenCalendar(calendar) {
  const byId = new Map();
  for (const entry of Object.values(calendar ?? {}).flat()) {
    if (entry?.workoutID) byId.set(entry.workoutID, entry);
  }
  return [...byId.values()].sort((a, b) => (a.timeStarted ?? 0) - (b.timeStarted ?? 0));
}
