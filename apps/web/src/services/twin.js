/**
 * Capa de datos del front: todo viene de la API (services/timeline.js). Lo que no hay se queda en
 * null y la vista lo dice; nada se rellena con datos inventados. La recuperación aún no se
 * calcula. Si la API falla, se propaga el error.
 */
import { apiFetch } from '../api.js';
import { addDays, dateRange, minutesOfDay, todayISO } from '../lib/dates.js';
import {
  activityFrom,
  emptySummary,
  fetchDayDetail,
  fetchRange,
  mergeDay,
  mergeSummary,
  temperatureBaseline,
} from './timeline.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CACHE_MS = 2 * 60 * 1000;
const cache = new Map(); // url → { at, promise }

/**
 * GET del timeline con caché corta y sin duplicados: lo que se pide a la vez (el día y su
 * historia comparten rango) o hace poco sale de memoria. Si la API pide esperar (429) se reintenta
 * una vez. Los fallos no se guardan.
 */
function cachedGet(path) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = (async () => {
    try {
      return await apiFetch(path);
    } catch (err) {
      if (err.status !== 429) throw err;
      await wait(1500);
      return apiFetch(path);
    }
  })();
  cache.set(path, { at: Date.now(), promise });
  promise.catch(() => cache.delete(path));
  return promise;
}

/** Tras una sincronización lo guardado puede estar viejo. */
export const clearTimelineCache = () => cache.clear();

/**
 * Día completo: puntuaciones, constantes, FC, pasos por hora y eventos. Si la API falla, falla
 * (la vista lo dice): nunca se enseñan datos de ejemplo como si fueran tuyos.
 */
export async function fetchDay(date) {
  const real = await fetchDayDetail(cachedGet, date);
  // El día anterior se precarga: la flecha de atrás sale al momento
  fetchDayDetail(cachedGet, addDays(date, -1)).catch(() => {});
  const isToday = date === todayISO();
  return mergeDay({ ...emptySummary(date), isToday, until: isToday ? minutesOfDay() : 1440 }, real);
}

const BASELINE_DAYS = 30;

/**
 * Resúmenes de `days` días hasta `end`. Se piden 30 días más para la línea base de la VFC (media
 * de los 30 días anteriores con dato, como hacen los relojes), y luego se quedan los pedidos.
 */
async function summaries(end, days) {
  const list = dateRange(end, days + BASELINE_DAYS - 1).map(emptySummary);
  const real = await fetchRange(cachedGet, list[0].date, end);
  const baseline = temperatureBaseline(real.daily);
  const merged = list.map((s) =>
    mergeSummary(s, real.episodes.get(s.date), real.daily.get(s.date), baseline),
  );
  return merged.slice(-days).map((s, i) => {
    const window = merged
      .slice(i, i + BASELINE_DAYS)
      .map((d) => d.hrv)
      .filter((v) => v != null);
    return {
      ...s,
      hrvBaseline: window.length
        ? Math.round(window.reduce((a, b) => a + b, 0) / window.length)
        : null,
    };
  });
}

/** Resúmenes diarios de los últimos `days` días hasta `end` (incluido). */
export function fetchSummaries(days, end = todayISO()) {
  return summaries(end, days);
}

/** Resúmenes de los `days` días anteriores al rango (para comparar periodos). */
export function fetchPreviousSummaries(days, end = todayISO()) {
  return summaries(addDays(end, -days), days);
}

/** Los entrenos reales de los últimos `days` días, del más reciente al más antiguo. */
export async function fetchActivities(days = 42, end = todayISO()) {
  const real = await fetchRange(cachedGet, addDays(end, -(days - 1)), end);
  return [...real.episodes.values()]
    .flatMap((day) => day.workouts.map(activityFrom))
    .filter((a) => a.date >= addDays(end, -(days - 1)) && a.date <= end)
    .sort((a, b) => b.date.localeCompare(a.date) || b.start - a.start);
}

/**
 * Estado de cada proveedor (esto ya va contra la API). `persistent: false` = la API las tiene en
 * memoria (le falta TOKEN_ENCRYPTION_KEY) y se pierden al reiniciarla.
 */
export const fetchConnections = () => apiFetch('/api/v1/connections');

const post = (path, body) => apiFetch(path, { method: 'POST', body: JSON.stringify(body) });

/**
 * Login de Xiaomi por pasos. Cada paso devuelve `status`: CAPTCHA_REQUIRED (con `captcha`, una
 * imagen en data URL), EMAIL_CODE_REQUIRED o CONNECTED (con `connection`).
 */
export const xiaomiLogin = {
  /** @param {{ username: string, password: string, region: string }} credentials */
  start: (credentials) => post('/api/v1/connections/xiaomi/login', credentials),
  captcha: (loginId, code) => post(`/api/v1/connections/xiaomi/login/${loginId}/captcha`, { code }),
  emailCode: (loginId, code) =>
    post(`/api/v1/connections/xiaomi/login/${loginId}/email-code`, { code }),
};

/** OAuth (Google, Strava...): la API devolverá la URL del proveedor y se redirige. */
export async function connectProvider(id) {
  const { url } = await apiFetch(`/api/v1/connections/${id}/connect`, { method: 'POST' });
  window.location.assign(url);
}

/**
 * Trae lo nuevo del proveedor. Con BD la API lo encola para el worker y responde
 * `{ queued: true }`; sin ella (solo Xiaomi) lo hace en el momento y devuelve `{ added, total }`.
 */
/** intervals.icu con la clave personal: la API la comprueba y devuelve la conexión. */
export const connectIntervals = (apiKey) =>
  post('/api/v1/connections/intervals-icu/connect', { apiKey });

export async function syncProvider(id) {
  clearTimelineCache();
  if (!['xiaomi', 'google-health', 'intervals-icu'].includes(id)) {
    throw Object.assign(new Error(`La API aún no sincroniza ${id}`), { code: 'NOT_IMPLEMENTED' });
  }
  return apiFetch(`/api/v1/connections/${id}/sync`, { method: 'POST' });
}

/**
 * Empieza a vincular Telegram: devuelve `{ code, command, url, expiresAt }`. `url` abre el bot con
 * el código puesto (null si la API aún no sabe cómo se llama el bot: entonces se escribe `command`).
 */
export const linkTelegram = () => apiFetch('/api/v1/connections/telegram/link', { method: 'POST' });

export async function unlinkTelegram() {
  await apiFetch('/api/v1/connections/telegram', { method: 'DELETE' });
}

export async function disconnectProvider(id) {
  await apiFetch(`/api/v1/connections/${id}`, { method: 'DELETE' });
}

/** Estado real de la API y la BD (esto sí va contra la API). */
export const fetchSystemStatus = () => apiFetch('/api/v1/health/ready');

/**
 * Sistema (solo admin): lo último que ha llegado de fuera y el historial de la cola.
 * @param {{ failed?: boolean, name?: string, limit?: number }} [filters]
 */
export function fetchSystemActivity({ failed, name, limit } = {}) {
  const params = new URLSearchParams();
  if (failed) params.set('failed', 'true');
  if (name) params.set('name', name);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return apiFetch(`/api/v1/admin/system/activity${qs ? `?${qs}` : ''}`);
}

/** Registrar: agua, café, peso, síntoma o nota apuntados a mano. */
export async function createEntry(entry) {
  const created = await apiFetch('/api/v1/entries', {
    method: 'POST',
    body: JSON.stringify(entry),
  });
  clearTimelineCache();
  return created;
}

export async function deleteEntry(id) {
  await apiFetch(`/api/v1/entries/${encodeURIComponent(id)}`, { method: 'DELETE' });
  clearTimelineCache();
}

/** Medicamentos ya apuntados, para sugerirlos en Registrar. */
export const fetchMedications = () => apiFetch('/api/v1/entries/medications').then((r) => r.items);

/** Tu perfil: edad, sexo, altura y peso objetivo (lo no escrito sale de la báscula). */
export const fetchProfile = () => apiFetch('/api/v1/profile');
export const saveProfile = (patch) =>
  apiFetch('/api/v1/profile', { method: 'PUT', body: JSON.stringify(patch) });

/** El motor: peso tendencia, gasto real y objetivos de comida (los calcula la API). */
export const fetchEngine = () => apiFetch('/api/v1/engine');
