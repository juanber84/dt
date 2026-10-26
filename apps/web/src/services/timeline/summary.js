/** El resumen de un día (cifras) y su detalle (eventos), con lo real. Funciones puras. */
import { FLUID_BASE_ML, fluidTargetMl as fluidFor } from '@digitaltwin/engine';
import { EMPTY_DAY } from './days.js';
import { round1 } from './events/common.js';
import { clinicalEvent } from './events/clinical.js';
import { entryEvent } from './events/entry.js';
import { mealEvent } from './events/meal.js';
import { SLEEP_NEED, sleepEvent, sleepFrom } from './events/sleep.js';
import { weighInEvent } from './events/weigh-in.js';
import { workoutEvent } from './events/workout.js';
import { DAILY_FIELDS } from './kinds.js';

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
export const DEFAULT_TARGETS = Object.freeze({ proteinG: 160, fluidMl: FLUID_BASE_ML });

/** Líquidos del día según lo entrenado (la fórmula, en @digitaltwin/engine: la misma del informe). */
export function fluidTargetMl(workouts = []) {
  const minutes = workouts.reduce((sum, w) => {
    const seconds =
      w.summary?.durationS ?? (w.end ? (new Date(w.end) - new Date(w.start)) / 1000 : 0);
    return sum + Math.max(0, seconds) / 60;
  }, 0);
  return fluidFor(minutes);
}

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
      beveragesMl: null,
      fluidMl: null,
      fluidTargetMl: DEFAULT_TARGETS.fluidMl,
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
  const { tss, ctl, atl, basalKcal, waterMl, beveragesMl, muscleMass } = real;
  delete real.sleepTemp;
  delete real.basalKcal;
  delete real.tss;
  delete real.ctl;
  delete real.atl;
  delete real.waterMl;
  delete real.beveragesMl;
  delete real.muscleMass;
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
    nutrition: {
      ...summary.nutrition,
      ...totals.nutrition,
      target: totalKcal,
      waterMl,
      beveragesMl,
      // Líquidos totales: agua + otras bebidas. null solo si no hay ni una cosa ni la otra
      fluidMl: waterMl != null || beveragesMl != null ? (waterMl ?? 0) + (beveragesMl ?? 0) : null,
      fluidTargetMl: fluidTargetMl(day.workouts),
    },
    weight: totals.weight,
    bodyFat: totals.bodyFat,
    muscle: totals.muscle ?? muscleMass,
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
    ...(mine.entries ?? []).map(entryEvent),
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
