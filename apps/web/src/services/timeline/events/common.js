/** Lo que comparten los eventos del timeline. */
import { parseISODate } from '../../../lib/dates.js';

export const round1 = (n) => Math.round((n ?? 0) * 10) / 10;
// El bot (y lo importado) llega como proveedor "digitaltwin" con el canal en el stream
export const sourceOf = (episode) => episode.origin?.channel ?? episode.provider;
/** Minutos desde la medianoche local de `date` (negativos: la víspera). */
export const minutesFrom = (date, time) =>
  Math.round((new Date(time) - parseISODate(date)) / 60_000);
