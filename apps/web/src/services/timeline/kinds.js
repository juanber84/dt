/** Qué tipos de episodio y qué métricas diarias pide el front al timeline. */

/** Episodios de los informes médicos (Clínica). */
export const CLINICAL_KINDS = [
  'lab',
  'holter',
  'stress-test',
  'ecg',
  'imaging',
  'medical-test',
  'medical-report',
  'clinical-note',
];
/** Tipo de documento de Clínica → kind de su episodio (como el normalizador de la API). */
export const CLINICAL_KIND_OF_TYPE = {
  lab: 'lab',
  holter: 'holter',
  stress_test: 'stress-test',
  ecg: 'ecg',
  imaging: 'imaging',
  other_test: 'medical-test',
  report: 'medical-report',
};

/** Bloques de los días que ya salen de datos reales (el resto sigue siendo de ejemplo). */
export const REAL_KINDS = [
  'meal',
  'weigh-in',
  'workout',
  'sleep',
  // Lo apuntado a mano (Registrar o el bot)
  'drink',
  'symptom',
  'note',
  'medication',
  'period',
  ...CLINICAL_KINDS,
];
export const ENTRY_KINDS = ['drink', 'symptom', 'note', 'medication', 'period'];

/** Métrica del timeline → campo del resumen diario (con su conversión). */
export const DAILY_METRICS = {
  'heart.hrv_daily': ['hrv'],
  'heart.resting_rate': ['rhr'],
  'blood.oxygen_saturation_daily': ['spo2', (v) => Math.round(v * 10) / 10],
  'respiration.rate_daily': ['respRate', (v) => Math.round(v * 10) / 10],
  'body.sleep_temperature': ['sleepTemp'],
  // La masa muscular de la báscula: como métrica, para no depender del detalle del pesaje
  'body.muscle_mass': ['muscleMass', (v) => Math.round(v * 10) / 10],
  'activity.steps': ['steps'],
  'activity.distance': ['distanceKm', (v) => Math.round(v / 100) / 10],
  'activity.floors': ['floors'],
  'energy.active': ['activeKcal'],
  'energy.basal': ['basalKcal'],
  'intake.water': ['waterMl', (v) => Math.round(v)],
  'intake.beverages': ['beveragesMl', (v) => Math.round(v)],
  'fitness.vo2max': ['vo2max', (v) => Math.round(v * 10) / 10],
  // intervals.icu: TSS del día y forma/fatiga
  'training.load': ['tss'],
  'training.ctl': ['ctl', (v) => Math.round(v * 10) / 10],
  'training.atl': ['atl', (v) => Math.round(v * 10) / 10],
};
export const DAILY_FIELDS = Object.values(DAILY_METRICS).map(([field]) => field);
