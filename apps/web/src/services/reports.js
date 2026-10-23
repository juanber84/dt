/** Informes (el de cada mañana y, más adelante, los que pidas al coach) y sus preferencias. */
import { apiFetch } from '../api.js';

export const listReports = () => apiFetch('/api/v1/reports');

export const fetchReport = (id) => apiFetch(`/api/v1/reports/${encodeURIComponent(id)}`);

export const fetchReportSettings = () => apiFetch('/api/v1/reports/settings');

export const saveReportSettings = (patch) =>
  apiFetch('/api/v1/reports/settings', { method: 'PUT', body: JSON.stringify(patch) });

/** Hace el de ayer ahora y lo manda por correo. */
export const sendDailyNow = () => apiFetch('/api/v1/reports/daily', { method: 'POST' });

const number = (value, digits = 0) =>
  new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);

/** "72,4 kg", "1.248 / 1.820 kcal" o "sin datos" (como formatStat de @digitaltwin/reports). */
export function formatStat({ value, unit, digits = 0, target }) {
  if (value == null) return 'sin datos';
  const t = target != null ? ` / ${number(target, digits)}` : '';
  return `${number(value, digits)}${t}${unit ? ` ${unit}` : ''}`;
}

/** "jueves 22 de octubre" de "2026-10-22". */
export function reportDay(date) {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
    .format(new Date(`${date}T12:00:00Z`))
    .replace(',', '');
}
