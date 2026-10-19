// Fechas como 'YYYY-MM-DD' en hora local: es lo que usan las rutas (/day/2026-10-14) y la API.

const pad = (n) => String(n).padStart(2, '0');

export function toISODate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const todayISO = () => toISODate(new Date());

export function addDays(iso, days) {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export const isValidISODate = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  toISODate(parseISODate(value)) === value;

/** Fechas de `days` días que terminan en `end` (incluida), de más antigua a más reciente. */
export function dateRange(end, days) {
  return Array.from({ length: days }, (_, i) => addDays(end, i - days + 1));
}

const longFormat = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const shortFormat = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const weekdayFormat = new Intl.DateTimeFormat('es-ES', { weekday: 'short' });

export const formatLongDate = (iso) => longFormat.format(parseISODate(iso));
export const formatShortDate = (iso) => shortFormat.format(parseISODate(iso)).replace('.', '');
export const formatWeekday = (iso) => weekdayFormat.format(parseISODate(iso)).replace('.', '');

export function relativeDayLabel(iso, today = todayISO()) {
  if (iso === today) return 'Hoy';
  if (iso === addDays(today, -1)) return 'Ayer';
  return null;
}

/** Minutos desde la medianoche local. */
export function minutesOfDay(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}
