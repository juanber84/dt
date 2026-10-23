/**
 * Qué comida del día es cada plato. Sin dependencias: lo usan la API, el bot, los informes y la
 * web. El orden es el del día.
 */
export const MEAL_TYPES = Object.freeze([
  'breakfast',
  'mid-morning',
  'lunch',
  'afternoon-snack',
  'dinner',
  'snack',
]);

export const MEAL_TYPE_LABELS = Object.freeze({
  breakfast: 'Desayuno',
  'mid-morning': 'Media mañana',
  lunch: 'Comida',
  'afternoon-snack': 'Merienda',
  dinner: 'Cena',
  snack: 'Picoteo',
});
