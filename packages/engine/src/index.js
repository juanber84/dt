/**
 * El motor de Digital Twin: los números salen de aquí, con modelos sencillos y comprobables, no de
 * la IA (el coach los explica). Funciones puras: entran los datos de cada día, sale el estado.
 *
 * Sigue lo que publica MacroFactor de su método (los pesos exactos de su algoritmo no son
 * públicos):
 *   - Peso de la báscula con los huecos rellenos en línea recta, y su tendencia (media que pesa
 *     más lo reciente): el agua de un día no mueve nada.
 *   - Gasto = lo que comes − lo que cambia la tendencia (en energía). Es el gasto "efectivo": si
 *     apuntas de menos de forma constante, queda absorbido y el objetivo sale en tus unidades.
 *   - Funciona como un predictor: arranca de una fórmula (rebajada, porque suelen pasarse) y se
 *     corrige con lo que pasa de verdad; los primeros 30 días corrige más fuerte.
 *   - Solo cuentan los días apuntados de verdad (desde `loggingSince` y que no estén a medias):
 *     un día con media comida apuntada es su punto débil.
 *   - Objetivo como % del peso por semana; proteína según la masa magra, grasa con un mínimo y el
 *     resto hidratos.
 */

import { currentPeriod, markPeriods } from './periods.js';

const DAY_MS = 24 * 3600 * 1000;
const KCAL_PER_KG_FAT = 7700;
const KCAL_PER_KG_LEAN = 1800;

// Redondea a `step` sin colas de coma flotante (0.41000000000000003)
const round = (value, step = 1) => {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Number((Math.round(value / step) * step).toFixed(decimals));
};
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const addDays = (date, n) => new Date(Date.parse(date) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

/** Huecos más largos que esto no se rellenan: unir pesajes de hace semanas inventaría una tendencia. */
export const MAX_GAP_DAYS = 7;

/** Días apuntados que hacen falta para avisar de que lo apuntado no cuadra con el peso. */
export const MISMATCH_MIN_DAYS = 14;

/** Lo que pesa un pesaje "dudoso" (al volver de un periodo, o enfermo) frente a uno normal. */
export const DOUBTFUL_WEIGHT = 1 / 3;

/**
 * Peso de la báscula día a día: los días sin pesaje, en línea recta entre el anterior y el
 * siguiente (como MacroFactor), si el hueco no pasa de MAX_GAP_DAYS. Antes del primero, nada;
 * después del último, se mantiene hasta MAX_GAP_DAYS.
 * @param {Array<{ date: string, weight: number|null }>} days  ordenados y seguidos
 */
export function fillWeights(days) {
  const known = days.map((d, i) => [i, d.weight]).filter(([, w]) => w != null);
  return days.map((d, i) => {
    if (d.weight != null) return d.weight;
    const before = [...known].reverse().find(([j]) => j < i);
    const after = known.find(([j]) => j > i);
    if (!before) return null;
    if (!after) return i - before[0] <= MAX_GAP_DAYS ? before[1] : null;
    if (after[0] - before[0] > MAX_GAP_DAYS) return null;
    const t = (i - before[0]) / (after[0] - before[0]);
    return before[1] + t * (after[1] - before[1]);
  });
}

/**
 * Tendencia del peso: media móvil exponencial sobre el peso relleno (el 10 % del día nuevo, como
 * la Hacker's Diet). Arranca en la mediana de los primeros pesajes: si arrancara en el primero, un
 * primer pesaje raro sesgaría semanas.
 * @returns {Array<{ date: string, weight: number|null, filled: number|null, trend: number|null }>}
 */
export function weightTrend(days, { alpha = 0.1 } = {}) {
  // Fuera de casa no hay pesajes válidos (otra báscula marca distinto): se quitan y el hueco se
  // mantiene en el último peso de casa, no en línea recta hacia el de la vuelta (que trae agua)
  const home = days.map((d) => (d.period === 'away' ? { ...d, weight: null } : d));
  const filled = fillWeights(home);
  for (let i = 1; i < days.length; i++) {
    if (days[i].period === 'away' && filled[i - 1] != null) filled[i] = filled[i - 1];
  }
  // Tras un hueco largo (o al principio) se vuelve a arrancar: mediana de los 5 pesajes siguientes
  const seed = (from) => {
    const next = days
      .slice(from)
      .map((d) => d.weight)
      .filter((w) => w != null)
      .slice(0, 5)
      .sort((a, b) => a - b);
    return next[Math.floor(next.length / 2)];
  };
  let trend = null;
  return days.map((d, i) => {
    if (filled[i] == null) {
      trend = null;
      return { date: d.date, weight: null, filled: null, trend: null };
    }
    trend ??= seed(i);
    // Al volver de un periodo, o enfermo, el pesaje cuenta menos: el salto suele ser agua
    const doubtful = d.period === 'settling' || d.period === 'sick';
    trend += (doubtful ? alpha * DOUBTFUL_WEIGHT : alpha) * (filled[i] - trend);
    return {
      date: d.date,
      weight: home[i].weight ?? null,
      filled: filled[i],
      trend: round(trend, 0.01),
    };
  });
}

/** Metabolismo basal (Mifflin-St Jeor). Sin sexo, la media de las dos fórmulas. */
export function bmr({ weightKg, heightCm, age, sex }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  if (sex === 'male') return base + 5;
  if (sex === 'female') return base - 161;
  return base - 78;
}

/** Factor de actividad según los pasos de media (sin pasos, uno intermedio). */
export function activityFactor(avgSteps) {
  if (avgSteps == null) return 1.5;
  if (avgSteps < 5000) return 1.35;
  if (avgSteps < 8000) return 1.45;
  if (avgSteps < 11000) return 1.55;
  return 1.65;
}

/**
 * Gasto de partida: basal × actividad, rebajado (como hace MacroFactor) un 6 % porque las fórmulas
 * suelen pasarse, y 4 veces el ritmo de pérdida buscado (el cuerpo gasta algo menos en déficit).
 */
export function initialExpenditure({ bmr: basal, avgSteps, weeklyRatePct }) {
  const loss = Math.max(0, -weeklyRatePct);
  return round(basal * activityFactor(avgSteps) * (1 - 0.06 - (4 * loss) / 100), 10);
}

/**
 * Energía de un kg de peso perdido o ganado: perdiendo despacio es casi todo grasa; rápido, entra
 * más músculo (que tiene mucha menos energía por kg).
 */
export function energyPerKg(weeklyRatePct) {
  const speed = Math.abs(weeklyRatePct);
  const fat = speed <= 0.5 ? 0.9 : speed <= 1 ? 0.8 : 0.7;
  return fat * KCAL_PER_KG_FAT + (1 - fat) * KCAL_PER_KG_LEAN;
}

/**
 * Si un día cuenta para calcular el gasto: desde que lo apunta todo, con comida de verdad (no una
 * comida suelta) y nunca el día en curso.
 */
export function isLoggedDay(day, { since, today, expected }) {
  if (day.date >= today || (since && day.date < since)) return false;
  // En un periodo (o justo después) ni lo comido ni el peso dicen cuánto gastas de normal
  if (day.period) return false;
  if (day.kcal == null || (day.dishes ?? 0) < 2) return false;
  return day.kcal >= expected * 0.4;
}

/**
 * El predictor del gasto. Cada día (con ventana de 7) en el que hay al menos 4 días apuntados, el
 * gasto observado es lo comido menos el cambio de la tendencia; el estimado se acerca a él un
 * paso: más grande los 30 primeros días (calibración), más fino después.
 * @returns {{ kcal, initial, observed, intakeAvg, trendKgPerWeek, loggedDays, updates,
 *   confidence, mismatch, history }}
 */
export function predictExpenditure({ days, initial, since, today, density }) {
  let kcal = initial;
  let updates = 0;
  let last = null;
  const history = [];
  const logged = (d) => isLoggedDay(d, { since, today, expected: kcal });
  for (let i = 6; i < days.length; i++) {
    const day = days[i];
    if (day.date >= today) break;
    const window = days.slice(i - 6, i + 1);
    // Si la ventana toca un periodo, el cambio de la tendencia lleva agua o un hueco: no se aprende
    if (window.some((d) => d.period)) {
      history.push({ date: day.date, kcal: round(kcal, 10) });
      continue;
    }
    const inWindow = window.filter(logged);
    const start = window[0].trend;
    const end = window[6].trend;
    if (inWindow.length >= 4 && start != null && end != null) {
      const intakeAvg = mean(inWindow.map((d) => d.kcal));
      const observed = intakeAvg - ((end - start) * density) / 7;
      const first = since ?? inWindow[0].date;
      const step = daysBetween(first, day.date) <= 30 ? 0.15 : 0.07;
      kcal += step * (observed - kcal);
      updates++;
      last = { observed, intakeAvg, trendKgPerWeek: end - start };
    }
    history.push({ date: day.date, kcal: round(kcal, 10) });
  }
  const loggedDays = days.filter(logged).length;
  return {
    kcal: round(kcal, 10),
    initial,
    observed: last ? round(last.observed, 10) : null,
    intakeAvg: last ? round(last.intakeAvg, 10) : null,
    trendKgPerWeek: last ? round(last.trendKgPerWeek, 0.01) : null,
    loggedDays,
    updates,
    confidence:
      updates === 0 ? 'none' : loggedDays < 7 ? 'low' : loggedDays < 21 ? 'medium' : 'high',
    // Lo apuntado no cuadra con lo que hace el peso: o falta comida por apuntar o el peso va con
    // agua (enfermedad, sal, retención). Con menos de dos semanas el agua lo domina todo: no se dice
    mismatch: last && loggedDays >= MISMATCH_MIN_DAYS ? last.observed < initial * 0.75 : false,
    history,
  };
}

/**
 * Objetivos del día para el gasto y el ritmo: kcal; proteína 2,3 g por kg de masa magra (o
 * 1,8 g/kg de peso si no se sabe la grasa); grasa 0,8 g/kg; el resto hidratos.
 */
export function nutritionTargets({ expenditure, weightKg, bodyFatPct, weeklyRatePct, density }) {
  const kgPerWeek = (weeklyRatePct / 100) * weightKg;
  const kcal = round(expenditure + (kgPerWeek * density) / 7, 10);
  const lean = bodyFatPct != null ? weightKg * (1 - bodyFatPct / 100) : null;
  const proteinG = round(lean != null ? 2.3 * lean : 1.8 * weightKg, 5);
  const fatG = round(0.8 * weightKg, 5);
  const carbsG = Math.max(0, round((kcal - proteinG * 4 - fatG * 9) / 4, 5));
  return { kcal, proteinG, fatG, carbsG, kgPerWeek: round(kgPerWeek, 0.01) };
}

/**
 * El estado del motor para una persona en un día.
 * @param {object} input
 * @param {{ age, sex, heightCm, loggingSince?, weeklyRatePct? }} input.profile
 * @param {Array<{ date, weight?, bodyFat?, kcal?, dishes?, steps? }>} input.days
 *   días seguidos y ordenados (los que falten, con nulls), hasta hoy incluido
 * @param {string} input.today  YYYY-MM-DD local
 * @param {Array<{ type: 'away' | 'sick' | 'other', from: string, to: string }>} [input.periods]
 *   fuera de casa, enfermo...: el motor no aprende de esos días (ver markPeriods)
 */
export function computeState({ profile, days: input, today, periods = [] }) {
  const days = markPeriods(input, periods);
  const withTrend = weightTrend(days);
  const current = [...withTrend].reverse().find((d) => d.trend != null);
  const missing = [
    ...['age', 'heightCm'].filter((k) => profile?.[k] == null),
    ...(current ? [] : ['weight']),
  ];
  if (missing.length) return { ready: false, missing };

  const weeklyRatePct = profile.weeklyRatePct ?? -0.5;
  const density = energyPerKg(weeklyRatePct);
  const steps = days
    .slice(-14)
    .map((d) => d.steps)
    .filter((s) => s != null);
  const basal = round(
    bmr({
      weightKg: current.trend,
      heightCm: profile.heightCm,
      age: profile.age,
      sex: profile.sex,
    }),
    10,
  );
  const initial = initialExpenditure({
    bmr: basal,
    avgSteps: steps.length ? mean(steps) : null,
    weeklyRatePct,
  });
  const merged = days.map((d, i) => ({ ...d, trend: withTrend[i].trend }));
  const expenditure = predictExpenditure({
    days: merged,
    initial,
    since: profile.loggingSince ?? null,
    today,
    density,
  });
  const bodyFat = [...days].reverse().find((d) => d.bodyFat != null)?.bodyFat ?? null;
  const period = currentPeriod(periods, today);

  return {
    ready: true,
    today,
    weight: {
      trend: current.trend,
      // El último de su báscula: lo de otra báscula, fuera de casa, no cuenta
      last: [...withTrend].reverse().find((d) => d.weight != null)?.weight ?? null,
      bodyFat,
    },
    period,
    bmr: basal,
    weeklyRatePct,
    expenditure,
    // Fuera de casa o enfermo, a mantenimiento: no es momento de déficit
    targets: nutritionTargets({
      expenditure: expenditure.kcal,
      weightKg: current.trend,
      bodyFatPct: bodyFat,
      weeklyRatePct: period?.phase === 'during' ? 0 : weeklyRatePct,
      density,
    }),
    trend: withTrend.slice(-42).map(({ date, weight, trend }) => ({ date, weight, trend })),
  };
}

export { addDays };
export {
  PERIOD_NAMES,
  SETTLING_DAYS,
  markPeriods,
  currentPeriod,
  periodPhrase,
} from './periods.js';
export { fluidTargetMl, FLUID_BASE_ML, FLUID_PER_TRAINING_HOUR_ML } from './fluids.js';
// El motor ya con los datos de un usuario (BD): su perfil y su estado. Lo usan la API y el worker.
export { createEngine } from './service.js';
export { createProfiles } from './profiles.js';
