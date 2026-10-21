import { normalizeXiaomiScale } from './xiaomi.js';
import { normalizeGoogleDay, isGoogleNormalized } from './google.js';
import { normalizeEntry, normalizeMeal } from './digitaltwin.js';
import { normalizeIntervalsActivity, normalizeIntervalsWellness } from './intervals.js';
import { normalizeClinical } from './clinical.js';

/**
 * Normalizador de cada (proveedor, tipo) de raw_records. Reciben el payload y devuelven:
 *   mode          'range' (el registro es la verdad en su periodo: se reemplaza todo lo de ese
 *                 rango) o 'exact' (solo lo que generó este registro)
 *   metrics       (modo range) métricas que posee, para borrarlas aunque hoy no vengan
 *   observations  [{ origin, originDetails, metric, time, end?, value }]
 *   episodes      [{ origin, originDetails, kind, externalId, start, end, title, summary, schema, details }]
 *   newMetrics    (opcional) código → { unit, aggregation, label } de las métricas que no están en el
 *                 catálogo (los parámetros raros de una analítica), para darlas de alta bien
 * Devuelven null si ese tipo aún no se normaliza (se queda en raw_records).
 */
export function normalizerFor(provider, kind) {
  if (provider === 'xiaomi' && kind === 'scale') return normalizeXiaomiScale;
  if (provider === 'google-health' && isGoogleNormalized(kind)) return normalizeGoogleDay;
  if (provider === 'digitaltwin' && kind === 'meal') return normalizeMeal;
  if (provider === 'digitaltwin' && kind === 'entry') return normalizeEntry;
  if (provider === 'intervals-icu' && kind === 'activity') return normalizeIntervalsActivity;
  if (provider === 'intervals-icu' && kind === 'wellness') return normalizeIntervalsWellness;
  if (provider === 'clinical') return normalizeClinical;
  return null;
}

export {
  normalizeXiaomiScale,
  normalizeGoogleDay,
  normalizeMeal,
  normalizeEntry,
  normalizeIntervalsActivity,
  normalizeIntervalsWellness,
  normalizeClinical,
};
export {
  GOOGLE_MEASURES,
  GOOGLE_EPISODES,
  googleMetricsFor,
  googleOrigin,
  isGoogleNormalized,
} from './google.js';
export { XIAOMI_METRICS } from './xiaomi.js';
export { ENTRY_KINDS } from './digitaltwin.js';
export { CLINICAL_EPISODES, clinicalPeriod, customMetricCode } from './clinical.js';
