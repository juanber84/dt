/** Informes (el de cada mañana y, más adelante, los que pidas al coach) y sus preferencias. */
import { apiFetch } from '../api.js';

export const listReports = () => apiFetch('/api/v1/reports');

export const fetchReport = (id) => apiFetch(`/api/v1/reports/${encodeURIComponent(id)}`);

export const fetchReportSettings = () => apiFetch('/api/v1/reports/settings');

export const saveReportSettings = (patch) =>
  apiFetch('/api/v1/reports/settings', { method: 'PUT', body: JSON.stringify(patch) });

/** Hace el de ayer ahora y lo manda por correo. */
export const sendDailyNow = () => apiFetch('/api/v1/reports/daily', { method: 'POST' });

// Las cifras, como en el correo del informe
export { formatStat } from '@digitaltwin/reports/format';

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
