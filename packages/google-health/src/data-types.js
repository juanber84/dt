/**
 * Catálogo de tipos de datos legibles de la Google Health API v4.
 * Fuente: discovery doc health:v4 (rev. 20261007) + https://developers.google.com/health/data-types
 *
 * kind determina el filtro por fechas:
 *  - interval: {t}.interval.start_time          (instante, >= y <)
 *  - sample:   {t}.sample_time.physical_time    (instante, >= y <)
 *  - daily:    {t}.date                         (fecha local YYYY-MM-DD)
 *  - session:  {t}.interval.civil_start_time    (hora local, sin zona)
 *  - sleep:    sleep.interval.end_time          (filtra por la hora de FIN)
 *  - ecg:      electrocardiogram.interval.start_time (solo >=; el "hasta" se filtra en cliente)
 */
const BASE = 'https://www.googleapis.com/auth/googlehealth.';

export const SCOPES = Object.freeze({
  PROFILE: `${BASE}profile.readonly`,
  SETTINGS: `${BASE}settings.readonly`,
  ACTIVITY: `${BASE}activity_and_fitness.readonly`,
  HEALTH_METRICS: `${BASE}health_metrics_and_measurements.readonly`,
  SLEEP: `${BASE}sleep.readonly`,
  ECG: `${BASE}ecg.readonly`,
  IRN: `${BASE}irn.readonly`,
  NUTRITION: `${BASE}nutrition.readonly`,
});

/** Scopes por defecto en el login: todo lo legible. */
export const DEFAULT_SCOPES = Object.freeze(Object.values(SCOPES));

/**
 * Escritura (Google separa leer y escribir). Solo dejan añadir, editar o borrar lo que crea la
 * propia app: no tocan lo que escriben el reloj u otras apps.
 */
export const WRITE_SCOPES = Object.freeze({
  // Comidas e hidratación (lo que registra el bot)
  NUTRITION: `${BASE}nutrition.writeonly`,
  // Peso, grasa corporal y demás medidas (p. ej. las de la báscula Xiaomi)
  HEALTH_METRICS: `${BASE}health_metrics_and_measurements.writeonly`,
});

const t = (id, kind, scope, webhook, extra = {}) => ({
  id,
  field: id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()),
  filterField: id.replace(/-/g, '_'),
  kind,
  scope,
  webhook,
  method: 'list',
  ...extra,
});

const { ACTIVITY: AF, HEALTH_METRICS: HM, SLEEP, ECG, IRN, NUTRITION: NU } = SCOPES;

export const DATA_TYPES = Object.freeze(
  [
    // Actividad
    t('steps', 'interval', AF, true),
    t('distance', 'interval', AF, true),
    t('floors', 'interval', AF, true, { method: 'reconcile' }), // floors no soporta list
    t('altitude', 'interval', AF, true),
    t('active-minutes', 'interval', AF, true),
    t('active-zone-minutes', 'interval', AF, true),
    t('activity-level', 'interval', AF, true),
    t('sedentary-period', 'interval', AF, true),
    t('time-in-heart-rate-zone', 'interval', AF, true),
    t('active-energy-burned', 'interval', AF, false),
    t('basal-energy-burned', 'interval', AF, false),
    t('swim-lengths-data', 'interval', AF, false),
    t('exercise', 'session', AF, true, { pageSize: 25 }),
    t('vo2-max', 'sample', AF, false),
    t('run-vo2-max', 'sample', AF, true),
    t('daily-vo2-max', 'daily', AF, false),
    // Métricas de salud
    t('heart-rate', 'sample', HM, true),
    t('heart-rate-variability', 'sample', HM, true),
    t('oxygen-saturation', 'sample', HM, false),
    t('respiratory-rate-sleep-summary', 'sample', HM, true),
    t('core-body-temperature', 'sample', HM, false),
    t('blood-glucose', 'sample', HM, true),
    t('weight', 'sample', HM, true),
    t('body-fat', 'sample', HM, true),
    t('height', 'sample', HM, true),
    t('daily-resting-heart-rate', 'daily', HM, true),
    t('daily-heart-rate-variability', 'daily', HM, true),
    t('daily-heart-rate-zones', 'daily', HM, true),
    t('daily-oxygen-saturation', 'daily', HM, true),
    t('daily-respiratory-rate', 'daily', HM, true),
    t('daily-sleep-temperature-derivations', 'daily', HM, true),
    // Sueño
    t('sleep', 'sleep', SLEEP, true, { pageSize: 25 }),
    // Corazón (dispositivo médico)
    t('electrocardiogram', 'ecg', ECG, false, { pageSize: 100 }),
    t('irregular-rhythm-notification', 'session', IRN, false),
    // Nutrición
    t('hydration-log', 'session', NU, true),
    t('nutrition-log', 'session', NU, true),
  ].map(Object.freeze),
);

const BY_ID = new Map(DATA_TYPES.map((d) => [d.id, d]));

export function getDataType(id) {
  const type = BY_ID.get(id);
  if (!type) {
    throw new Error(`Tipo de dato desconocido: "${id}". Ver DATA_TYPES para la lista.`);
  }
  return type;
}

/** Tipos que se pueden leer con los scopes concedidos. */
export function dataTypesForScopes(scopes) {
  const granted = new Set(typeof scopes === 'string' ? scopes.split(' ') : scopes);
  return DATA_TYPES.filter((d) => granted.has(d.scope));
}
