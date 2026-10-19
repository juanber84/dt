import { sumDishes } from '@digitaltwin/nutrition';

const INTAKE = [
  ['intake.energy', 'kcal'],
  ['intake.protein', 'proteinG'],
  ['intake.carbs', 'carbsG'],
  ['intake.fat', 'fatG'],
  ['intake.fiber', 'fiberG'],
];

/**
 * Una comida confirmada (mealEntrySchema de @digitaltwin/nutrition) → un episodio por plato (cada
 * uno con su hora) y sus macros como observaciones. Si dos platos van a la misma hora se suman.
 */
export function normalizeMeal(entry) {
  const origin = entry.channel ?? entry.source ?? 'manual';
  const originDetails = { channel: origin };
  const episodes = [];
  const totals = new Map();

  entry.dishes.forEach((dish, index) => {
    const total = sumDishes([dish]);
    const time = new Date(dish.eatenAt).toISOString();
    episodes.push({
      origin,
      originDetails,
      kind: 'meal',
      externalId: `${entry.id}:${index}`,
      start: time,
      end: null,
      title: dish.name,
      summary: {
        kcal: total.kcal,
        proteinG: total.proteinG,
        carbsG: total.carbsG,
        fatG: total.fatG,
        fiberG: total.fiberG,
      },
      schema: 'meal@1',
      details: {
        entryId: entry.id,
        items: dish.items,
        text: entry.text,
        notes: entry.notes ?? '',
        createdAt: entry.createdAt,
      },
    });
    const at = totals.get(time) ?? {};
    for (const [metric, key] of INTAKE) at[metric] = (at[metric] ?? 0) + (total[key] ?? 0);
    totals.set(time, at);
  });

  const observations = [];
  for (const [time, values] of totals) {
    for (const [metric, value] of Object.entries(values)) {
      observations.push({ origin, originDetails, metric, time, value });
    }
  }
  return { mode: 'exact', observations, episodes };
}
