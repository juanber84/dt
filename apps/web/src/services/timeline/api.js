/**
 * Las llamadas a /api/v1/timeline: un rango de días (episodios sin detalle y valores diarios) y
 * el detalle de un día. Devuelven lo ya agrupado por días (days.js).
 */
import { addDays, minutesOfDay, parseISODate } from '../../lib/dates.js';
import { byDay, dailyValues, hourly } from './days.js';
import { DAILY_METRICS, REAL_KINDS } from './kinds.js';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const localIso = (iso) => parseISODate(iso).toISOString();
const query = (params) => new URLSearchParams(params).toString();

/** Desde el mediodía de la víspera: la noche que acaba el primer día empieza el día antes. */
function sinceEve(startIso) {
  const before = parseISODate(addDays(startIso, -1));
  before.setHours(12);
  return before.toISOString();
}

const episodesUrl = (from, to, details) =>
  `/api/v1/timeline/episodes?${query({ from, to, kinds: REAL_KINDS.join(','), tz: TZ, ...(!details && { details: 'false' }) })}`;

/**
 * Lo real de [startIso, endIso] (días locales): episodios y valores diarios. Los episodios van
 * sin su detalle (fases del sueño, vueltas, ingredientes: la mayor parte del peso), que solo hace
 * falta en el día que se mira (fetchDayDetail lo pide aparte).
 */
export async function fetchRange(apiFetch, startIso, endIso) {
  const to = localIso(addDays(endIso, 1));
  const [episodes, series] = await Promise.all([
    apiFetch(episodesUrl(sinceEve(startIso), to, false)),
    apiFetch(
      `/api/v1/timeline/series?${query({ from: localIso(startIso), to, bucket: 'day', metrics: Object.keys(DAILY_METRICS).join(','), tz: TZ })}`,
    ),
  ]);
  return { episodes: byDay(episodes.items), daily: dailyValues(series.series) };
}

/**
 * Lo de un día: su rango (30 días de historia para las medias, sin detalle), sus episodios con
 * todo el detalle y lo de por horas.
 */
export async function fetchDayDetail(apiFetch, date) {
  const from = localIso(date);
  const to = localIso(addDays(date, 1));
  const [range, detailed, steps, hr] = await Promise.all([
    fetchRange(apiFetch, addDays(date, -29), date),
    apiFetch(episodesUrl(sinceEve(date), to, true)),
    apiFetch(
      `/api/v1/timeline/series?${query({ from, to, bucket: 'hour', metrics: 'activity.steps', tz: TZ })}`,
    ),
    apiFetch(`/api/v1/timeline/observations?${query({ from, to, metric: 'heart.rate' })}`),
  ]);
  // El día que se mira, con su detalle (el resto del rango se queda con el resumen)
  const episodes = new Map(range.episodes);
  const day = byDay(detailed.items).get(date);
  if (day) episodes.set(date, day);
  else episodes.delete(date);
  return {
    ...range,
    episodes,
    stepsByHour: hourly(steps.series['activity.steps']?.points ?? []),
    hr: hr.items.map((o) => ({ t: minutesOfDay(new Date(o.t)), bpm: Math.round(o.value) })),
  };
}
