/**
 * Objetivo de líquidos del día (agua + otras bebidas): la base de un adulto activo (~2,5 L de
 * bebidas; la comida aporta aparte) más lo que se suda entrenando a intensidad moderada, en pasos
 * de 100 ml. Sin dependencias: lo usan los informes y la web.
 */
export const FLUID_BASE_ML = 2500;
export const FLUID_PER_TRAINING_HOUR_ML = 500;

/** @param {number} trainingMinutes  Minutos entrenados ese día */
export function fluidTargetMl(trainingMinutes = 0) {
  const extra = (Math.max(0, trainingMinutes) / 60) * FLUID_PER_TRAINING_HOUR_ML;
  return FLUID_BASE_ML + Math.round(extra / 100) * 100;
}
