/**
 * Datos reales del timeline (/api/v1/timeline) para las vistas. Lo que no llega se queda en null:
 * nada se inventa. Por partes, en timeline/:
 *  - api.js: las llamadas (un rango de días y el detalle de un día).
 *  - days.js: lo que devuelve la API, agrupado por día local.
 *  - events/: cómo se pinta cada tipo de evento (comida, apuntes, pesaje, Clínica, entreno, sueño).
 *  - summary.js: el resumen y el detalle de un día.
 * Todo menos api.js es puro, para probarlo sin API.
 */
export { CLINICAL_KINDS, REAL_KINDS } from './timeline/kinds.js';
export { fetchDayDetail, fetchRange } from './timeline/api.js';
export { byDay, dailyValues } from './timeline/days.js';
export { MEAL_TYPE_LABELS, mealEvent } from './timeline/events/meal.js';
export { entryEvent, periodRange } from './timeline/events/entry.js';
export { weighInEvent } from './timeline/events/weigh-in.js';
export {
  clinicalEvent,
  documentDay,
  documentEvent,
  withDocuments,
} from './timeline/events/clinical.js';
export { activityFrom, strengthExercises, workoutEvent } from './timeline/events/workout.js';
export { sleepFrom } from './timeline/events/sleep.js';
export {
  DEFAULT_TARGETS,
  emptySummary,
  fluidTargetMl,
  mergeDay,
  mergeSummary,
  realTotals,
  temperatureBaseline,
} from './timeline/summary.js';
