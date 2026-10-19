import { getDataType, getPointTime, toRecord } from '@digitaltwin/google-health';
import { localMidnight, parseDuration } from '../time.js';

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const scale = (factor) => (value) => (value === null ? null : value * factor);
const id = (value) => value;
// Apple Health solo mide SDNN y manda RMSSD a 0: un 0 ahí es "no medido"
const nonZero = (value) => (value === 0 ? null : value);

/**
 * Tipos de Google Health que son medidas: tipo → [métrica, campo, conversión].
 * Los campos salen del discovery doc health:v4. Los tipos que no están aquí ni en EPISODES se
 * guardan en raw_records y no se normalizan (se pueden añadir después y re-normalizar).
 */
export const GOOGLE_MEASURES = Object.freeze({
  // Muestras (instante)
  'heart-rate': [['heart.rate', 'beatsPerMinute', id]],
  'heart-rate-variability': [
    ['heart.hrv_rmssd', 'rootMeanSquareOfSuccessiveDifferencesMilliseconds', nonZero],
    ['heart.hrv_sdnn', 'standardDeviationMilliseconds', id],
  ],
  'oxygen-saturation': [['blood.oxygen_saturation', 'percentage', id]],
  'core-body-temperature': [['body.temperature', 'temperatureCelsius', id]],
  'blood-glucose': [['blood.glucose', 'bloodGlucoseMilligramsPerDeciliter', id]],
  weight: [['body.weight', 'weightGrams', scale(1 / 1000)]],
  'body-fat': [['body.fat_percent', 'percentage', id]],
  height: [['body.height', 'heightMillimeters', scale(1 / 1000)]],
  'vo2-max': [['fitness.vo2max', 'vo2Max', id]],
  'run-vo2-max': [['fitness.vo2max', 'runVo2Max', id]],
  // Intervalos (se guardan en su inicio, con end_time)
  steps: [['activity.steps', 'count', id]],
  distance: [['activity.distance', 'millimeters', scale(1 / 1000)]],
  floors: [['activity.floors', 'count', id]],
  altitude: [['activity.elevation_gain', 'gainMillimeters', scale(1 / 1000)]],
  'active-zone-minutes': [['activity.active_zone_minutes', 'activeZoneMinutes', id]],
  'active-energy-burned': [['energy.active', 'kcal', id]],
  'basal-energy-burned': [['energy.basal', 'kcal', id]],
  'hydration-log': [['intake.water', 'amountConsumed.milliliters', id]],
  // Diarios (a medianoche local)
  'daily-resting-heart-rate': [['heart.resting_rate', 'beatsPerMinute', id]],
  'daily-heart-rate-variability': [
    ['heart.hrv_daily', 'averageHeartRateVariabilityMilliseconds', id],
  ],
  'daily-oxygen-saturation': [['blood.oxygen_saturation_daily', 'averagePercentage', id]],
  'daily-respiratory-rate': [['respiration.rate_daily', 'breathsPerMinute', id]],
  'daily-vo2-max': [['fitness.vo2max', 'vo2Max', id]],
  'daily-sleep-temperature-derivations': [
    ['body.sleep_temperature', 'nightlyTemperatureCelsius', id],
  ],
});

/** Tipos que son episodios (con inicio y fin) y su extensión. */
export const GOOGLE_EPISODES = Object.freeze({
  exercise: workout,
  sleep,
  'nutrition-log': meal,
  electrocardiogram: () => ({ kind: 'ecg', schema: 'gh.ecg@1', title: 'ECG', summary: {} }),
  'irregular-rhythm-notification': () => ({
    kind: 'irregular-rhythm',
    schema: 'gh.irn@1',
    title: 'Aviso de ritmo irregular',
    summary: {},
  }),
});

/** Métricas que posee cada tipo: al normalizar un día se reemplazan aunque hoy no haya datos. */
export function googleMetricsFor(dataType) {
  const measures = (GOOGLE_MEASURES[dataType] ?? []).map(([metric]) => metric);
  if (dataType === 'nutrition-log') measures.push('intake.energy', 'intake.fat', 'intake.carbs');
  return [...new Set(measures)];
}

export function isGoogleNormalized(dataType) {
  return Boolean(GOOGLE_MEASURES[dataType] || GOOGLE_EPISODES[dataType]);
}

const pick = (value, path) => path.split('.').reduce((acc, key) => acc?.[key], value);

/** De dónde viene el punto dentro de Google (el reloj, la app de Xiaomi vía Apple Health...). */
export function googleOrigin(dataSource = {}) {
  const parts = [
    dataSource.platform ?? 'UNKNOWN',
    dataSource.application?.packageName ?? '',
    dataSource.device?.manufacturer ?? '',
    dataSource.device?.displayName ?? '',
  ];
  return {
    origin: parts.join('|'),
    originDetails: {
      platform: dataSource.platform ?? null,
      app: dataSource.application?.packageName ?? null,
      manufacturer: dataSource.device?.manufacturer ?? null,
      device: dataSource.device?.displayName ?? null,
      recordingMethod: dataSource.recordingMethod ?? null,
    },
  };
}

/**
 * Un día de un tipo de Google ({ dataType, from, to, points }) → observaciones y episodios.
 * Modo 'range': el día descargado es la verdad para ese rango (lo que ya no venga, se borra).
 * Los diarios van a medianoche local, que cae fuera del día UTC: su rango es el día local de esa
 * fecha, para que el día UTC anterior no los borre al re-normalizarse.
 */
export function normalizeGoogleDay(payload, { timeZone }) {
  const { dataType, points = [] } = payload;
  const observations = [];
  const episodes = [];
  const measures = GOOGLE_MEASURES[dataType];
  const episode = GOOGLE_EPISODES[dataType];

  for (const point of points) {
    const time = getPointTime(dataType, point);
    const start =
      time.start ?? (time.date ? localMidnight(time.date, timeZone).toISOString() : null);
    if (!start) continue;
    const { origin, originDetails } = googleOrigin(point.dataSource);
    const value = point[fieldOf(dataType)] ?? {};

    for (const [metric, path, convert] of measures ?? []) {
      const n = convert(num(pick(value, path)));
      if (n === null) continue;
      observations.push({ origin, originDetails, metric, time: start, end: time.end, value: n });
    }

    if (episode) {
      const record = toRecord(dataType, point);
      const { kind, schema, title, summary, extra = [] } = episode(value);
      episodes.push({
        origin,
        originDetails,
        kind,
        externalId: record.id,
        start,
        end: time.end,
        title,
        summary,
        schema,
        details: value,
      });
      for (const [metric, n] of extra) {
        if (n !== null)
          observations.push({
            origin,
            originDetails,
            metric,
            time: start,
            end: time.end,
            value: n,
          });
      }
    }
  }

  const result = { mode: 'range', metrics: googleMetricsFor(dataType), observations, episodes };
  if (getDataType(dataType).kind === 'daily' && payload.from) {
    const date = payload.from.slice(0, 10);
    const next = new Date(Date.parse(`${date}T00:00:00Z`) + 24 * 3600 * 1000);
    result.range = {
      from: localMidnight(date, timeZone).toISOString(),
      to: localMidnight(next.toISOString().slice(0, 10), timeZone).toISOString(),
    };
  }
  return result;
}

function fieldOf(dataType) {
  return dataType.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function workout(value) {
  const s = value.metricsSummary ?? {};
  return {
    kind: 'workout',
    schema: 'gh.exercise@1',
    title: value.displayName ?? value.exerciseType ?? 'Entreno',
    summary: {
      type: value.exerciseType ?? null,
      durationS: parseDuration(value.activeDuration),
      kcal: num(s.caloriesKcal),
      avgHeartRate: num(s.averageHeartRateBeatsPerMinute),
      distanceM: s.distanceMillimeters === undefined ? null : num(s.distanceMillimeters) / 1000,
      steps: num(s.steps),
    },
  };
}

function sleep(value) {
  const minutes = {};
  for (const stage of value.stages ?? []) {
    const ms = Date.parse(stage.endTime) - Date.parse(stage.startTime);
    if (!Number.isFinite(ms) || ms <= 0) continue;
    const type = String(stage.type ?? 'UNKNOWN').toLowerCase();
    minutes[type] = Math.round(((minutes[type] ?? 0) + ms / 60_000) * 10) / 10;
  }
  const asleep = Object.entries(minutes)
    .filter(([type]) => !['awake', 'out_of_bed', 'unknown'].includes(type))
    .reduce((acc, [, m]) => acc + m, 0);
  return {
    kind: 'sleep',
    schema: 'gh.sleep@1',
    title: 'Sueño',
    summary: { type: value.type ?? null, asleepMinutes: Math.round(asleep), stages: minutes },
  };
}

function meal(value) {
  const kcal = num(value.energy?.kcal);
  const fat = num(value.totalFat?.grams);
  const carbs = num(value.totalCarbohydrate?.grams);
  return {
    kind: 'meal',
    schema: 'gh.nutrition-log@1',
    title: value.foodDisplayName ?? value.food ?? 'Comida',
    summary: { kcal, fatG: fat, carbsG: carbs, mealType: value.mealType ?? null },
    extra: [
      ['intake.energy', kcal],
      ['intake.fat', fat],
      ['intake.carbs', carbs],
    ],
  };
}
