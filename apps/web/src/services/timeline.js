/**
 * Datos reales del timeline (/api/v1/timeline) y cómo se mezclan con los de ejemplo: lo que ya
 * llega de verdad sustituye a su parte del mock y el resto (recuperación y carga) se queda igual.
 * Las funciones de mezcla son puras para poder probarlas sin API.
 */
import { addDays, minutesOfDay, parseISODate, toISODate } from '../lib/dates.js';
import { fmtDec, fmtDuration, fmtInt } from '../lib/format.js';

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
const CLINICAL_KIND_OF_TYPE = {
  lab: 'lab',
  holter: 'holter',
  stress_test: 'stress-test',
  ecg: 'ecg',
  imaging: 'imaging',
  other_test: 'medical-test',
  report: 'medical-report',
};

/** Bloques de los días que ya salen de datos reales (el resto sigue siendo de ejemplo). */
export const REAL_KINDS = ['meal', 'weigh-in', 'workout', 'sleep', ...CLINICAL_KINDS];

/** Métrica del timeline → campo del resumen diario (con su conversión). */
const DAILY_METRICS = {
  'heart.hrv_daily': ['hrv'],
  'heart.resting_rate': ['rhr'],
  'blood.oxygen_saturation_daily': ['spo2', (v) => Math.round(v * 10) / 10],
  'respiration.rate_daily': ['respRate', (v) => Math.round(v * 10) / 10],
  'body.sleep_temperature': ['sleepTemp'],
  'activity.steps': ['steps'],
  'activity.distance': ['distanceKm', (v) => Math.round(v / 100) / 10],
  'activity.floors': ['floors'],
  'energy.active': ['activeKcal'],
  'energy.basal': ['basalKcal'],
  'intake.water': ['waterMl', (v) => Math.round(v)],
  'fitness.vo2max': ['vo2max', (v) => Math.round(v * 10) / 10],
  // intervals.icu: TSS del día y forma/fatiga
  'training.load': ['tss'],
  'training.ctl': ['ctl', (v) => Math.round(v * 10) / 10],
  'training.atl': ['atl', (v) => Math.round(v * 10) / 10],
};
const DAILY_FIELDS = Object.values(DAILY_METRICS).map(([field]) => field);
const SLEEP_NEED = 480;
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const localIso = (iso) => parseISODate(iso).toISOString();
const query = (params) => new URLSearchParams(params).toString();

/**
 * Lo real de [startIso, endIso] (días locales): episodios y valores diarios. El sueño se pide
 * desde el mediodía anterior porque la noche que acaba el primer día empieza la víspera.
 */
export async function fetchRange(apiFetch, startIso, endIso) {
  const to = localIso(addDays(endIso, 1));
  const before = parseISODate(addDays(startIso, -1));
  before.setHours(12);
  const [episodes, series] = await Promise.all([
    apiFetch(
      `/api/v1/timeline/episodes?${query({ from: before.toISOString(), to, kinds: REAL_KINDS.join(','), tz: TZ })}`,
    ),
    apiFetch(
      `/api/v1/timeline/series?${query({ from: localIso(startIso), to, bucket: 'day', metrics: Object.keys(DAILY_METRICS).join(','), tz: TZ })}`,
    ),
  ]);
  return { episodes: byDay(episodes.items), daily: dailyValues(series.series) };
}

/** Lo de un día: su rango (con 30 días de historia para las medias) y el detalle por horas. */
export async function fetchDayDetail(apiFetch, date) {
  const from = localIso(date);
  const to = localIso(addDays(date, 1));
  const [range, steps, hr] = await Promise.all([
    fetchRange(apiFetch, addDays(date, -29), date),
    apiFetch(
      `/api/v1/timeline/series?${query({ from, to, bucket: 'hour', metrics: 'activity.steps', tz: TZ })}`,
    ),
    apiFetch(`/api/v1/timeline/observations?${query({ from, to, metric: 'heart.rate' })}`),
  ]);
  return {
    ...range,
    stepsByHour: hourly(steps.series['activity.steps']?.points ?? []),
    hr: hr.items.map((o) => ({ t: minutesOfDay(new Date(o.t)), bpm: Math.round(o.value) })),
  };
}

// --- Normalización de lo que devuelve la API ------------------------------------------------

/** Series diarias → Map fecha → { hrv, rhr, steps... }. */
export function dailyValues(series) {
  const out = new Map();
  for (const [code, [field, convert = (v) => Math.round(v)]] of Object.entries(DAILY_METRICS)) {
    for (const p of series[code]?.points ?? []) {
      if (p.value == null) continue;
      const date = toISODate(new Date(p.t));
      if (!out.has(date)) out.set(date, {});
      out.get(date)[field] = convert(p.value);
    }
  }
  return out;
}

function hourly(points) {
  const hours = Array(24).fill(0);
  for (const p of points) hours[new Date(p.t).getHours()] += p.value ?? 0;
  return hours.map(Math.round);
}

/**
 * Episodios por día local: comidas, pesajes y entrenos por su inicio; el sueño por su fin (la
 * noche que acaba esa mañana) y, si hay varios (siestas), el más largo.
 */
export function byDay(episodes) {
  const out = new Map();
  const get = (date) => {
    if (!out.has(date)) {
      out.set(date, { meals: [], weighIns: [], workouts: [], clinical: [], sleep: null });
    }
    return out.get(date);
  };
  for (const e of episodes) {
    if (e.kind === 'sleep') {
      const day = get(toISODate(new Date(e.end ?? e.start)));
      const asleep = e.summary?.asleepMinutes ?? 0;
      if (!day.sleep || asleep > (day.sleep.summary?.asleepMinutes ?? 0)) day.sleep = e;
    } else {
      const day = get(toISODate(new Date(e.start)));
      if (e.kind === 'meal') day.meals.push(e);
      if (e.kind === 'weigh-in') day.weighIns.push(e);
      if (e.kind === 'workout') day.workouts.push(e);
      if (CLINICAL_KINDS.includes(e.kind)) day.clinical.push(e);
    }
  }
  return out;
}

const EMPTY_DAY = { meals: [], weighIns: [], workouts: [], clinical: [], sleep: null };

// --- Eventos del timeline -------------------------------------------------------------------

const round1 = (n) => Math.round((n ?? 0) * 10) / 10;
// El bot (y lo importado) llega como proveedor "digitaltwin" con el canal en el stream
const sourceOf = (episode) => episode.origin?.channel ?? episode.provider;
/** Minutos desde la medianoche local de `date` (negativos: la víspera). */
const minutesFrom = (date, time) => Math.round((new Date(time) - parseISODate(date)) / 60_000);

export function mealEvent(episode) {
  const s = episode.summary ?? {};
  const macros = {
    kcal: Math.round(s.kcal ?? 0),
    protein: round1(s.proteinG),
    carbs: round1(s.carbsG),
    fat: round1(s.fatG),
  };
  const items = episode.details?.items ?? [];
  return {
    id: episode.id,
    category: 'nutrition',
    icon: 'Utensils',
    title: episode.title,
    subtitle: `${fmtInt(macros.kcal)} kcal · ${fmtDec(macros.protein, 1)} g proteína`,
    start: minutesOfDay(new Date(episode.start)),
    metrics: [
      { label: 'Calorías', value: macros.kcal, unit: 'kcal' },
      { label: 'Proteína', value: macros.protein, unit: 'g', digits: 1 },
      { label: 'Hidratos', value: macros.carbs, unit: 'g', digits: 1 },
      { label: 'Grasa', value: macros.fat, unit: 'g', digits: 1 },
    ],
    macros,
    sources: [
      {
        source: sourceOf(episode),
        primary: true,
        externalId: episode.details?.entryId ?? episode.id,
        recordedAt: episode.details?.createdAt ?? episode.start,
        values: {
          text: episode.details?.text ?? '',
          alimentos: items.map((i) => `${i.name} (${Math.round(i.kcal)} kcal)`).join(' · '),
          ...(episode.details?.notes && { notas: episode.details.notes }),
        },
      },
    ],
  };
}

export function weighInEvent(episode) {
  // Fuera el perfil de la báscula (nombre, nacimiento...): no es del pesaje
  const values = { ...episode.details };
  delete values.profile;
  delete values.user;
  const weight = episode.summary?.weight ?? values.weight;
  const bodyFat = episode.summary?.bodyFat ?? values.bodyFat;
  const metrics = [
    { label: 'Peso', value: weight, unit: 'kg', digits: 1 },
    { label: 'Grasa', value: bodyFat, unit: '%', digits: 1 },
    { label: 'Músculo', value: values.muscleMass, unit: 'kg', digits: 1 },
    { label: 'Agua', value: values.bodyWater, unit: '%', digits: 1 },
  ].filter((m) => m.value != null);
  return {
    id: episode.id,
    category: 'body',
    icon: 'Scale',
    title: 'Pesaje',
    subtitle: `${fmtDec(weight, 1)} kg${bodyFat != null ? ` · grasa ${fmtDec(bodyFat, 1)}%` : ''}`,
    start: minutesOfDay(new Date(episode.start)),
    metrics,
    sources: [
      {
        source: sourceOf(episode),
        primary: true,
        externalId: episode.id,
        recordedAt: episode.start,
        values,
      },
    ],
  };
}

const CLINICAL_ICON = {
  lab: 'FlaskConical',
  holter: 'HeartPulse',
  'stress-test': 'Gauge',
  ecg: 'Activity',
  imaging: 'ScanLine',
  'medical-test': 'Stethoscope',
  'medical-report': 'ClipboardList',
  'clinical-note': 'FileText',
};
// Lo que se enseña de un holter o una prueba de esfuerzo (summary.measures)
const CLINICAL_MEASURES = [
  ['hr_min', 'FC mín.', 'ppm'],
  ['hr_avg', 'FC media', 'ppm'],
  ['hr_max', 'FC máx.', 'ppm'],
  ['sdnn', 'SDNN', 'ms'],
  ['vo2max', 'VO2max', 'mL/kg/min', 1],
  ['vt1_hr', 'VT1', 'ppm'],
  ['vt2_hr', 'VT2', 'ppm'],
  ['max_power', 'Potencia máx.', 'W'],
  ['pr_ms', 'PR', 'ms'],
  ['qrs_ms', 'QRS', 'ms'],
  ['qtc_ms', 'QTc', 'ms'],
];
const shortDate = (iso) =>
  new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })
    .format(parseISODate(iso))
    .replace('.', '');
const FLAG = { high: '↑', low: '↓', abnormal: '!' };

/**
 * Un informe médico en el día: lo fuera de rango (analíticas), sus medidas (pruebas) o el
 * diagnóstico (informes). Al pincharlo se abre el documento en el lateral (`clinical`).
 */
export function clinicalEvent(episode) {
  const s = episode.summary ?? {};
  const start = minutesOfDay(new Date(episode.start));
  const decimals = (text) => (String(text).split(/[.,]/)[1] ?? '').length;
  const flagged = (s.flaggedItems ?? [])
    .map((i) => ({
      label: `${FLAG[i.flag] ?? ''} ${i.name}`.trim(),
      value: Number(String(i.text).replace(',', '.')),
      unit: i.unit ?? undefined,
      digits: decimals(i.text),
    }))
    .filter((m) => Number.isFinite(m.value));
  const measures = CLINICAL_MEASURES.filter(([key]) => s.measures?.[key] != null).map(
    ([key, label, unit, digits]) => ({ label, value: s.measures[key], unit, digits }),
  );
  const parts =
    episode.kind === 'lab'
      ? [
          s.items && `${s.items} valores`,
          s.flagged ? `${s.flagged} fuera de rango` : 'todo en rango',
        ]
      : episode.kind === 'medical-report'
        ? [s.diagnosis, s.restTo && `reposo hasta el ${shortDate(s.restTo)}`]
        : [s.center];
  return {
    // Mismo id para el documento antes y después de confirmarlo (y para enlazarlo desde Clínica)
    id: s.documentId ? `clinical-${s.documentId}` : episode.id,
    category: 'clinical',
    icon: CLINICAL_ICON[episode.kind] ?? 'FileText',
    title: episode.title,
    subtitle: parts.filter(Boolean).join(' · '),
    start,
    end: episode.end
      ? start + Math.round((new Date(episode.end) - new Date(episode.start)) / 60_000)
      : undefined,
    metrics: episode.kind === 'lab' ? flagged : measures,
    ...(s.documentId && { clinical: { documentId: s.documentId, status: 'confirmed' } }),
    sources: [
      {
        source: 'clinical',
        primary: true,
        externalId: s.documentId ?? episode.id,
        recordedAt: episode.start,
        values: {
          ...(s.center && { centro: s.center }),
          ...(s.items != null && { valores: s.items }),
          ...(s.flagged != null && { 'fuera de rango': s.flagged }),
        },
      },
    ],
  };
}

/** El día en que va un documento: el de la prueba, el de la subida o el de creación. */
export function documentDay(doc) {
  return doc.date ?? doc.requestedDate ?? toISODate(new Date(doc.createdAt));
}

const PENDING_SUBTITLE = {
  processing: 'Leyendo el informe…',
  review: 'Por revisar: confirma lo leído',
  error: 'No se ha podido leer',
};
// Las analíticas no traen hora: a primera hora, como en la API
const DOCUMENT_HOUR = 8 * 60;

/**
 * Un documento de Clínica (de GET /clinical/documents) como evento del día, esté como esté: los
 * que faltan por revisar también salen, para revisarlos desde ahí. `day` es el día en que va.
 */
export function documentEvent(doc, day = documentDay(doc)) {
  // start/end son hora local sin zona ("2026-09-30T13:30"): new Date las lee en local
  const start = doc.start ? new Date(doc.start) : null;
  const end = doc.end ? new Date(doc.end) : null;
  const created = new Date(doc.createdAt);
  // Sin hora: la de subida si se subió ese mismo día y aún no se ha leído; si no, las 08:00
  let at = start;
  if (!at) {
    const minutes = !doc.date && toISODate(created) === day ? minutesOfDay(created) : DOCUMENT_HOUR;
    at = parseISODate(day);
    at.setHours(Math.floor(minutes / 60), minutes % 60);
  }
  const event = clinicalEvent({
    id: `clinical-${doc.id}`,
    kind: CLINICAL_KIND_OF_TYPE[doc.type] ?? 'clinical-note',
    title: doc.title ?? (doc.status === 'processing' ? 'Informe' : doc.fileName),
    start: at.toISOString(),
    end: start && end ? end.toISOString() : null,
    summary: {
      documentId: doc.id,
      center: doc.center,
      items: doc.counts?.items,
      flagged: doc.counts?.flagged,
      flaggedItems: doc.flaggedItems,
      measures: doc.measures,
      diagnosis: doc.diagnosis,
      restTo: doc.restTo,
    },
  });
  if (doc.status === 'confirmed') return event;
  return {
    ...event,
    icon: doc.status === 'processing' ? 'FileText' : event.icon,
    subtitle: PENDING_SUBTITLE[doc.status] ?? event.subtitle,
    metrics: doc.status === 'review' ? event.metrics : [],
    clinical: { documentId: doc.id, status: doc.status },
  };
}

/**
 * Los eventos de Clínica del día salen de los documentos (así se ven también los pendientes y no
 * hay que esperar a que se normalice al confirmar): fuera los episodios de esos documentos.
 */
export function withDocuments(events, documents, day) {
  const mine = documents.filter((d) => documentDay(d) === day);
  const ids = new Set(documents.map((d) => `clinical-${d.id}`));
  return [...events.filter((e) => !ids.has(e.id)), ...mine.map((d) => documentEvent(d, day))].sort(
    (a, b) => a.start - b.start,
  );
}

// Tipos de Google (BIKING...) y de intervals.icu (Ride, MountainBikeRide...)
const WORKOUT_ICON = {
  BIKING: 'Bike',
  RUNNING: 'Footprints',
  WALKING: 'PersonStanding',
  HIKING: 'PersonStanding',
  STRENGTH_TRAINING: 'Dumbbell',
  WEIGHTLIFTING: 'Dumbbell',
  Ride: 'Bike',
  MountainBikeRide: 'Bike',
  GravelRide: 'Bike',
  VirtualRide: 'Bike',
  EBikeRide: 'Bike',
  Run: 'Footprints',
  TrailRun: 'Footprints',
  VirtualRun: 'Footprints',
  Walk: 'PersonStanding',
  Hike: 'PersonStanding',
  WeightTraining: 'Dumbbell',
};

export function workoutEvent(episode) {
  const s = episode.summary ?? {};
  const minutes = s.durationS
    ? Math.round(s.durationS / 60)
    : episode.end
      ? Math.round((new Date(episode.end) - new Date(episode.start)) / 60_000)
      : null;
  const km = s.distanceM ? round1(s.distanceM / 1000) : null;
  const parts = [
    minutes && fmtDuration(minutes),
    km && `${fmtDec(km, 1)} km`,
    s.avgHeartRate && `${Math.round(s.avgHeartRate)} ppm`,
    s.tss && `TSS ${Math.round(s.tss)}`,
  ].filter(Boolean);
  const start = minutesOfDay(new Date(episode.start));
  return {
    id: episode.id,
    category: 'activity',
    icon: WORKOUT_ICON[s.type] ?? 'Activity',
    title: episode.title,
    subtitle: parts.join(' · '),
    start,
    end: episode.end
      ? start + Math.round((new Date(episode.end) - new Date(episode.start)) / 60_000)
      : undefined,
    metrics: [
      { label: 'Duración', value: minutes, unit: 'min' },
      { label: 'Distancia', value: km, unit: 'km', digits: 1 },
      { label: 'FC media', value: s.avgHeartRate && Math.round(s.avgHeartRate), unit: 'ppm' },
      { label: 'TSS', value: s.tss && Math.round(s.tss) },
      { label: 'Calorías', value: s.kcal && Math.round(s.kcal), unit: 'kcal' },
      { label: 'Potencia media', value: s.avgPower && Math.round(s.avgPower), unit: 'W' },
      {
        label: 'Potencia normalizada',
        value: s.normalizedPower && Math.round(s.normalizedPower),
        unit: 'W',
      },
    ].filter((m) => m.value != null),
    sources: [
      {
        source: sourceOf(episode),
        primary: true,
        externalId: episode.id,
        recordedAt: episode.end ?? episode.start,
        values: { ...s, origen: episode.origin?.application ?? '' },
      },
    ],
  };
}

const SPORT_LABEL = {
  Bike: 'Ciclismo',
  Footprints: 'Carrera',
  PersonStanding: 'Caminata',
  Dumbbell: 'Fuerza',
};

/**
 * Un entreno real para la lista de Entrenos: con el mismo id que su evento del día, así el enlace
 * lleva al día y lo abre en el lateral.
 */
export function activityFrom(episode) {
  const s = episode.summary ?? {};
  const event = workoutEvent(episode);
  const minutes = event.metrics.find((m) => m.label === 'Duración')?.value ?? 0;
  const distanceKm = s.distanceM ? round1(s.distanceM / 1000) : null;
  const running = event.icon === 'Footprints';
  return {
    id: event.id,
    date: toISODate(new Date(episode.start)),
    start: event.start,
    title: episode.title,
    icon: event.icon,
    sportLabel: SPORT_LABEL[event.icon] ?? 'Entreno',
    minutes,
    distanceKm,
    paceSecPerKm: running && distanceKm ? Math.round((minutes * 60) / distanceKm) : null,
    avgPower: s.avgPower ? Math.round(s.avgPower) : null,
    avgHr: s.avgHeartRate ? Math.round(s.avgHeartRate) : null,
    tss: s.tss ? Math.round(s.tss) : null,
  };
}

const STAGE = { light: 'light', deep: 'deep', rem: 'rem', sleep: 'light' };

/** Noche de Google → el formato del mock: totales y fases en minutos desde la medianoche de `date`. */
export function sleepFrom(date, episode) {
  if (!episode) {
    return {
      totals: {
        minutes: 0,
        deep: 0,
        rem: 0,
        light: 0,
        awake: 0,
        efficiency: 0,
        score: 0,
        need: SLEEP_NEED,
      },
      detail: { start: 0, end: 0, stages: [] },
    };
  }
  const stages = (episode.details?.stages ?? [])
    .map((s) => ({
      stage: STAGE[String(s.type).toLowerCase()] ?? 'awake',
      start: minutesFrom(date, s.startTime),
      end: minutesFrom(date, s.endTime),
    }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const sum = (stage) =>
    stages.filter((s) => s.stage === stage).reduce((a, s) => a + s.end - s.start, 0);
  const totals = { deep: sum('deep'), rem: sum('rem'), light: sum('light'), awake: sum('awake') };
  const minutes = totals.deep + totals.rem + totals.light || (episode.summary?.asleepMinutes ?? 0);
  return {
    totals: {
      ...totals,
      minutes,
      efficiency: minutes ? Math.round((minutes / (minutes + totals.awake)) * 100) : 0,
      // Google no da puntuación: de momento, lo dormido frente a lo que necesitas
      score: Math.min(100, Math.round((minutes / SLEEP_NEED) * 100)),
      need: SLEEP_NEED,
    },
    detail: {
      start: stages[0]?.start ?? minutesFrom(date, episode.start),
      end: stages.at(-1)?.end ?? minutesFrom(date, episode.end ?? episode.start),
      stages,
    },
  };
}

function sleepEvent(date, episode, sleep) {
  const s = sleep.totals;
  return {
    id: episode.id,
    category: 'sleep',
    icon: 'Moon',
    title: 'Sueño',
    subtitle: `${fmtDuration(s.minutes)} dormido · eficiencia ${s.efficiency}%`,
    start: sleep.detail.start,
    end: sleep.detail.end,
    metrics: [
      { label: 'Profundo', value: s.deep, unit: 'min' },
      { label: 'REM', value: s.rem, unit: 'min' },
      { label: 'Ligero', value: s.light, unit: 'min' },
      { label: 'Despierto', value: s.awake, unit: 'min' },
    ],
    sleep: { ...sleep.detail, totals: s },
    sources: [
      {
        source: sourceOf(episode),
        primary: true,
        externalId: episode.id,
        recordedAt: episode.end ?? episode.start,
        values: { type: episode.summary?.type, asleepMinutes: episode.summary?.asleepMinutes },
      },
    ],
  };
}

// --- Resumen del día ---------------------------------------------------------------------

/** Totales reales de un día: comidas sumadas y el último pesaje (o null). */
export function realTotals({ meals, weighIns }) {
  // Sin comidas apuntadas no es "0 kcal": es que no hay dato (las medias no se hunden)
  const sum = (key) =>
    meals.length ? round1(meals.reduce((acc, e) => acc + (e.summary?.[key] ?? 0), 0)) : null;
  const last = weighIns.at(-1);
  return {
    nutrition: {
      kcal: meals.length ? Math.round(sum('kcal')) : null,
      protein: sum('proteinG'),
      carbs: sum('carbsG'),
      fat: sum('fatG'),
    },
    weight: last?.summary?.weight ?? last?.details?.weight ?? null,
    bodyFat: last?.summary?.bodyFat ?? last?.details?.bodyFat ?? null,
    muscle: last?.details?.muscleMass ?? null,
  };
}

/** Media de la temperatura nocturna de los días que haya: la del día se da como desviación. */
export function temperatureBaseline(daily) {
  const values = [...daily.values()].map((v) => v.sleepTemp).filter((v) => v != null);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

const NO_SLEEP = {
  minutes: null,
  deep: null,
  rem: null,
  light: null,
  awake: null,
  efficiency: null,
  score: null,
  need: SLEEP_NEED,
};

/**
 * Objetivos mientras no se puedan poner desde la app (los pondrá el módulo de objetivos). Las kcal
 * no tienen: el objetivo es lo que gastas ese día (basal + activas), cuando se sabe.
 */
export const DEFAULT_TARGETS = Object.freeze({ proteinG: 160, waterMl: 3000 });

/**
 * Un día sin ningún dato, con la forma que esperan las vistas: todo en null (nada inventado).
 * Recuperación y referencia de FC en reposo aún no se calculan.
 */
export function emptySummary(date) {
  return {
    date,
    recovery: null,
    hrv: null,
    hrvBaseline: null,
    rhr: null,
    spo2: null,
    respRate: null,
    skinTemp: null,
    vo2max: null,
    sleep: { ...NO_SLEEP },
    load: null,
    steps: null,
    distanceKm: null,
    activeKcal: null,
    totalKcal: null,
    floors: null,
    nutrition: {
      kcal: null,
      target: null,
      protein: null,
      carbs: null,
      fat: null,
      proteinTarget: DEFAULT_TARGETS.proteinG,
      waterMl: null,
      waterTargetMl: DEFAULT_TARGETS.waterMl,
    },
    weight: null,
    bodyFat: null,
    muscle: null,
  };
}

/**
 * Resumen de un día con lo real, sobre `summary` (emptySummary): lo que no haya ese día queda en
 * null, no inventado, y las medias de Tendencias solo cuentan los días con dato.
 */
export function mergeSummary(summary, day = EMPTY_DAY, values = {}, tempBaseline = null) {
  const totals = realTotals(day);
  const sleep = day.sleep ? sleepFrom(summary.date, day.sleep).totals : { ...NO_SLEEP };
  const real = Object.fromEntries(DAILY_FIELDS.map((f) => [f, values[f] ?? null]));
  const { tss, ctl, atl, basalKcal, waterMl } = real;
  delete real.sleepTemp;
  delete real.basalKcal;
  delete real.tss;
  delete real.ctl;
  delete real.atl;
  delete real.waterMl;
  // Carga solo con el CTL de intervals.icu de ese día; sin él, no hay
  const load =
    ctl != null ? { tss: tss ?? 0, ctl, atl, tsb: Math.round((ctl - atl) * 10) / 10 } : null;
  const totalKcal =
    real.activeKcal != null && basalKcal != null ? Math.round(real.activeKcal + basalKcal) : null;
  return {
    ...summary,
    ...real,
    load,
    recovery: null,
    hrvBaseline: null,
    totalKcal,
    skinTemp:
      values.sleepTemp != null && tempBaseline != null
        ? Math.round((values.sleepTemp - tempBaseline) * 100) / 100
        : null,
    sleep,
    nutrition: { ...summary.nutrition, ...totals.nutrition, target: totalKcal, waterMl },
    weight: totals.weight,
    bodyFat: totals.bodyFat,
    muscle: totals.muscle,
  };
}

/**
 * Detalle de un día (`day`: emptySummary + isToday y until) con lo real: los episodios, la FC y
 * los pasos por hora.
 */
export function mergeDay(day, { episodes, daily, stepsByHour, hr }) {
  const mine = episodes.get(day.date) ?? EMPTY_DAY;
  const summary = mergeSummary(day, mine, daily.get(day.date), temperatureBaseline(daily));
  const sleep = sleepFrom(day.date, mine.sleep);
  const n = summary.nutrition;
  const events = [
    ...(mine.sleep ? [sleepEvent(day.date, mine.sleep, sleep)] : []),
    ...mine.weighIns.map(weighInEvent),
    ...mine.meals.map(mealEvent),
    ...mine.workouts.map(workoutEvent),
    ...(mine.clinical ?? []).map(clinicalEvent),
  ].sort((a, b) => a.start - b.start);
  // Lo que no ha llegado sigue en null también aquí: un día sin pasos sincronizados no es "0
  // pasos" (la vista dice "sin datos"). Sin noche registrada no hay puntuación ni eficiencia.
  return {
    ...summary,
    sleep: mine.sleep ? sleep.totals : { ...NO_SLEEP },
    nutrition: n,
    sleepDetail: sleep.detail,
    stepsByHour: day.isToday
      ? stepsByHour.map((v, h) => (h * 60 > day.until ? null : v))
      : stepsByHour,
    hr,
    events,
  };
}
