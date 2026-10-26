import { apiFetch } from '../api.js';
import { parseISODate, todayISO } from '../lib/dates.js';

/** Los suplementos habituales (Ajustes → Cuenta). Las tomas se apuntan con createEntry. */
export const listSupplements = () => apiFetch('/api/v1/supplements').then((r) => r.items);
export const createSupplement = (input) =>
  apiFetch('/api/v1/supplements', { method: 'POST', body: JSON.stringify(input) });
export const updateSupplement = (id, patch) =>
  apiFetch(`/api/v1/supplements/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
export const deleteSupplement = (id) =>
  apiFetch(`/api/v1/supplements/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Cuándo se toma: el orden es el del día. La hora es la de la toma si se marca otro día. */
export const TIMINGS = [
  { value: 'morning', label: 'Mañana', hour: 9 },
  { value: 'midday', label: 'Mediodía', hour: 14 },
  { value: 'training', label: 'Con el entreno', hour: 18 },
  { value: 'evening', label: 'Tarde', hour: 19 },
  { value: 'night', label: 'Noche', hour: 22 },
];
const NOON = 12;

/** Los de siempre, para añadirlos de un toque (con lo más habitual de cada uno). */
export const PRESETS = [
  { name: 'Creatina', dose: '5 g', timing: 'morning' },
  { name: 'Magnesio', dose: '300 mg', timing: 'night' },
  { name: 'Vitamina D', dose: '2000 UI', timing: 'morning' },
  { name: 'Omega-3', dose: '1 g', timing: 'midday' },
];

export const timingLabel = (value) => TIMINGS.find((t) => t.value === value)?.label ?? null;

/** Los que tocaban ese día (ya empezados y sin dejar), en el orden del día. */
export function activeOn(supplements, date) {
  const order = (s) => {
    const i = TIMINGS.findIndex((t) => t.value === s.timing);
    return i < 0 ? TIMINGS.length : i;
  };
  return supplements
    .filter((s) => s.startedOn <= date && (!s.stoppedOn || s.stoppedOn > date))
    .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name, 'es'));
}

/**
 * Cuándo se apunta la toma: hoy, ahora; otro día, a la hora de su momento (o a mediodía), que
 * es lo que mejor dice cuándo fue.
 */
export function takenAt(supplement, date, now = new Date()) {
  if (date === todayISO()) return now.toISOString();
  const at = parseISODate(date);
  at.setHours(TIMINGS.find((t) => t.value === supplement.timing)?.hour ?? NOON);
  return at.toISOString();
}

/** Las tomas del día por suplemento: id del suplemento → id del registro (para deshacerla). */
export function takenToday(events) {
  const taken = new Map();
  for (const e of events) if (e.supplementId && e.entryId) taken.set(e.supplementId, e.entryId);
  return taken;
}

const TYPE_BY_NAME = [
  [/creatin/i, 'creatine'],
  [/magnesi/i, 'magnesium'],
  [/vit(amina)?\.?\s*d\b|\bd3\b/i, 'vitamin_d'],
  [/omega/i, 'omega_3'],
];

/**
 * El tipo sale del nombre ("Creatina monohidrato" → creatine): la app solo lo usa para la
 * creatina (el aviso del agua), así que no hace falta preguntarlo.
 */
export const typeOf = (name) => TYPE_BY_NAME.find(([re]) => re.test(name))?.[1] ?? 'other';
