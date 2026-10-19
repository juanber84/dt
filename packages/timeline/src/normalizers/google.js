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

// Lo que Apple Health manda a Google con su propio nombre: lo del Apple Watch y lo del iPhone.
// Hasta el 16/10/2026 cada aparato venía como com.apple.health.<UUID>; desde el 17, todos como
// com.apple.health y el iPhone con device.formFactor PHONE.
const APPLE_HEALTH = /^com\.apple\.health(\.[0-9a-f-]{36})?$/i;
export const APPLE_HEALTH_ORIGIN = 'HEALTH_KIT|com.apple.health';

const isAppleHealth = (dataSource = {}) =>
  dataSource.platform === 'HEALTH_KIT' &&
  APPLE_HEALTH.test(dataSource.application?.packageName ?? '');

/**
 * Tipos que se acumulan por intervalos (pasos, distancia, kcal...). Reloj e iPhone los miden a
 * la vez y Google manda los dos: sumarlos cuenta dos veces lo andado.
 */
const ADDITIVE = new Set([
  'steps',
  'distance',
  'floors',
  'altitude',
  'active-zone-minutes',
  'active-energy-burned',
  'basal-energy-burned',
]);

/**
 * El reloj apunta los pasos a trozos y entre uno y otro deja huecos aunque lo lleves puesto. Un
 * hueco más corto que esto cuenta como medido por el reloj; si no, la app Salud no rellena con el
 * iPhone. Ajustado con los totales de Salud (19/10/2026: reloj 7.442, Salud ~7.400; sin margen
 * salían 8.293).
 */
const WATCH_GAP_MS = 15 * 60 * 1000;

/**
 * De dónde viene el punto dentro de Google (el reloj, la app de Xiaomi vía Apple Health...).
 * Todo lo de Apple Health es un solo origen, como lo ve la app Salud: el reloj y el iPhone ya
 * se han combinado (ver appleDeviceShares), y el aparato cambia de un punto a otro.
 */
export function googleOrigin(dataSource = {}) {
  if (isAppleHealth(dataSource)) {
    return {
      origin: APPLE_HEALTH_ORIGIN,
      originDetails: {
        platform: 'HEALTH_KIT',
        app: 'com.apple.health',
        manufacturer: 'Apple Inc.',
      },
    };
  }
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
  const shares = ADDITIVE.has(dataType) ? appleDeviceShares(dataType, points) : null;

  for (const point of points) {
    const time = getPointTime(dataType, point);
    const start =
      time.start ?? (time.date ? localMidnight(time.date, timeZone).toISOString() : null);
    if (!start) continue;
    const { origin, originDetails } = googleOrigin(point.dataSource);
    const value = point[fieldOf(dataType)] ?? {};

    // Parte del punto que cuenta (el iPhone, solo lo que el reloj no ha medido)
    const share = shares?.get(point) ?? 1;
    if (share === 0) continue;

    for (const [metric, path, convert] of measures ?? []) {
      const n = convert(num(pick(value, path)));
      if (n === null) continue;
      const scaled = share === 1 ? n : Math.round(n * share * 100) / 100;
      observations.push({
        origin,
        originDetails,
        metric,
        time: start,
        end: time.end,
        value: scaled,
      });
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

/**
 * Lo mismo que hace la app Salud con lo que miden a la vez el reloj y el iPhone: manda el reloj,
 * y de cada intervalo del iPhone solo cuenta la parte que no cubre el reloj (en proporción al
 * tiempo). Los huecos de menos de WATCH_GAP_MS entre muestras del reloj cuentan como cubiertos.
 * Así un rato sin reloj se rellena con el iPhone sin contar dos veces el resto. Devuelve
 * punto → fracción (0–1) solo de los puntos del iPhone.
 * @returns {Map<object, number>}
 */
export function appleDeviceShares(dataType, points) {
  const apple = points.filter((p) => isAppleHealth(p.dataSource));
  const isPhone = (p) => p.dataSource?.device?.formFactor === 'PHONE';
  const phone = apple.filter(isPhone);
  const shares = new Map();
  if (!phone.length) return shares;

  const span = (p) => {
    const time = getPointTime(dataType, p);
    return [Date.parse(time.start), Date.parse(time.end ?? time.start)];
  };
  // Lo que cubre el reloj, como intervalos ordenados y sin solapes
  const covered = [];
  for (const [s, e] of apple
    .filter((p) => !isPhone(p))
    .map(span)
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e))
    .sort((a, b) => a[0] - b[0])) {
    const last = covered.at(-1);
    if (last && s <= last[1] + WATCH_GAP_MS) last[1] = Math.max(last[1], e);
    else covered.push([s, e]);
  }

  for (const point of phone) {
    const [s, e] = span(point);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    if (e <= s) {
      // Sin duración: cuenta entero salvo que caiga dentro de lo medido por el reloj
      shares.set(point, covered.some(([a, b]) => s >= a && s <= b) ? 0 : 1);
      continue;
    }
    let overlap = 0;
    for (const [a, b] of covered) {
      if (a >= e) break;
      overlap += Math.max(0, Math.min(b, e) - Math.max(a, s));
    }
    shares.set(point, Math.max(0, 1 - overlap / (e - s)));
  }
  return shares;
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
