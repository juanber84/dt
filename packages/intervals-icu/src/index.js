/**
 * Cliente mínimo de la API de intervals.icu con la clave personal del atleta (ajustes →
 * Developer Settings). Autenticación básica con el usuario literal "API_KEY" y el atleta "0"
 * (el dueño de la clave). Spec: https://intervals.icu/api/v1/docs
 */
export const IntervalsErrorCode = Object.freeze({
  INVALID_KEY: 'INVALID_KEY',
  RATE_LIMITED: 'RATE_LIMITED',
  API_ERROR: 'API_ERROR',
});

export class IntervalsError extends Error {
  /**
   * @param {keyof typeof IntervalsErrorCode} code
   * @param {string} message
   * @param {{ status?: number, retryAfterSeconds?: number }} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'IntervalsError';
    this.code = code;
    Object.assign(this, details);
  }
}

const BASE_URL = 'https://intervals.icu';

/**
 * @param {object} options
 * @param {string} options.apiKey
 * @param {typeof fetch} [options.fetch]
 * @param {string} [options.baseUrl]
 * @param {number} [options.timeoutMs]
 */
export function createIntervalsClient({
  apiKey,
  fetch = globalThis.fetch,
  baseUrl = BASE_URL,
  timeoutMs = 30_000,
}) {
  const auth = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`;

  async function get(path, params = {}) {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`${baseUrl}/api/v1${path}${query ? `?${query}` : ''}`, {
      headers: { Authorization: auth, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401 || res.status === 403) {
      throw new IntervalsError(
        IntervalsErrorCode.INVALID_KEY,
        'La clave de intervals.icu no vale',
        {
          status: res.status,
        },
      );
    }
    if (res.status === 429) {
      throw new IntervalsError(IntervalsErrorCode.RATE_LIMITED, 'intervals.icu pide esperar', {
        status: 429,
        retryAfterSeconds: Number(res.headers.get('retry-after')) || 60,
      });
    }
    if (!res.ok) {
      throw new IntervalsError(IntervalsErrorCode.API_ERROR, `intervals.icu ${res.status}`, {
        status: res.status,
      });
    }
    return res.json();
  }

  return {
    /** El atleta dueño de la clave (sirve para comprobarla al conectar). */
    athlete: () => get('/athlete/0'),

    /**
     * Actividades entre dos días locales (YYYY-MM-DD, incluidos). Las que intervals.icu no puede
     * compartir (Strava; quizá pronto Garmin) llegan como esqueleto sin datos: se quitan.
     */
    async activities({ oldest, newest }) {
      const list = await get('/athlete/0/activities', { oldest, newest });
      return list.filter(isShareable);
    },

    /** Wellness por día (CTL/ATL, FC en reposo, VFC, sueño, peso...) entre dos días locales. */
    wellness: ({ oldest, newest }) => get('/athlete/0/wellness', { oldest, newest }),
  };
}

/** Una actividad con datos de verdad (no el esqueleto con `_note` de las que no se comparten). */
export function isShareable(activity) {
  return Boolean(activity?.id && activity.start_date && activity.type && !activity._note);
}
