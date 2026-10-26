/** Lo que devuelve la API, agrupado por día local. Funciones puras, sin API. */
import { toISODate } from '../../lib/dates.js';
import { CLINICAL_KINDS, DAILY_METRICS, ENTRY_KINDS } from './kinds.js';

/** Series diarias → Map fecha → { hrv, rhr, steps... }. */
export function dailyValues(series) {
  const out = new Map();
  for (const [code, [field, convert = (v) => Math.round(v)]] of Object.entries(DAILY_METRICS)) {
    for (const p of series[code]?.points ?? []) {
      if (p.value == null) continue;
      const date = toISODate(new Date(p.t));
      if (!out.has(date)) out.set(date, {});
      out.get(date)[field] = convert(p.value);
    }
  }
  return out;
}

export function hourly(points) {
  const hours = Array(24).fill(0);
  for (const p of points) hours[new Date(p.t).getHours()] += p.value ?? 0;
  return hours.map(Math.round);
}

/** Un día sin episodios. */
const emptyDay = () => ({
  meals: [],
  weighIns: [],
  workouts: [],
  clinical: [],
  entries: [],
  sleep: null,
});

export const EMPTY_DAY = emptyDay();

/**
 * Episodios por día local: comidas, pesajes y entrenos por su inicio; el sueño por su fin (la
 * noche que acaba esa mañana) y, si hay varios (siestas), el más largo.
 */
export function byDay(episodes) {
  const out = new Map();
  const get = (date) => {
    if (!out.has(date)) out.set(date, emptyDay());
    return out.get(date);
  };
  for (const e of episodes) {
    if (e.kind === 'sleep') {
      const day = get(toISODate(new Date(e.end ?? e.start)));
      const asleep = e.summary?.asleepMinutes ?? 0;
      if (!day.sleep || asleep > (day.sleep.summary?.asleepMinutes ?? 0)) day.sleep = e;
    } else {
      const day = get(toISODate(new Date(e.start)));
      if (e.kind === 'meal') day.meals.push(e);
      if (e.kind === 'weigh-in') day.weighIns.push(e);
      if (e.kind === 'workout') day.workouts.push(e);
      if (CLINICAL_KINDS.includes(e.kind)) day.clinical.push(e);
      if (ENTRY_KINDS.includes(e.kind)) day.entries.push(e);
    }
  }
  return out;
}
