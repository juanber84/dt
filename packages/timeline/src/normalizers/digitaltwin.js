import { sumDishes, sumDrinks } from '@digitaltwin/nutrition';

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
    // Las bebidas: lo que hidratan y su cafeína (los platos sólidos dan 0)
    const drink = sumDrinks([dish]);
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
        ...(dish.mealType && { mealType: dish.mealType }),
        ...(drink.fluidMl && { fluidMl: drink.fluidMl }),
        ...(drink.caffeineMg && { caffeineMg: drink.caffeineMg }),
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
    if (drink.fluidMl) at['intake.beverages'] = (at['intake.beverages'] ?? 0) + drink.fluidMl;
    if (drink.caffeineMg) at['intake.caffeine'] = (at['intake.caffeine'] ?? 0) + drink.caffeineMg;
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

/** Nombre de cada tipo de periodo (si no se le pone otro). */
export const PERIOD_TITLES = Object.freeze({
  away: 'Fuera de casa',
  sick: 'Enfermo',
  other: 'Periodo',
});

/** Lo que se apunta a mano (app o bot) además de las comidas. */
export const ENTRY_KINDS = Object.freeze([
  'water',
  'drink',
  'coffee',
  'weight',
  'symptom',
  'note',
  'medication',
  'supplement',
  'period',
]);

/**
 * Un registro suelto (Registrar en la app: canal `manual`; o el bot: `telegram`):
 * { id, kind, at, value?, text?, channel }.
 *   water   ml de agua → intake.water + episodio `drink`
 *   drink   otra bebida: nombre (text), ml que hidratan (value) y cafeína (caffeineMg) →
 *           intake.beverages + intake.caffeine + episodio `drink`
 *   coffee  (los de antes de `drink`) mg de cafeína → intake.caffeine + episodio `drink`
 *   weight  kg → body.weight + episodio `weigh-in` (como un pesaje de la báscula)
 *   symptom texto + intensidad 1-5 → episodio `symptom`
 *   note    texto → episodio `note`
 *   medication  una toma: nombre (text) y dosis → episodio `medication`
 *   supplement  una toma de un suplemento: nombre (text), dosis y cuál de los habituales
 *               (supplementId) → episodio `supplement`
 */
export function normalizeEntry(entry) {
  const origin = entry.channel ?? 'manual';
  const originDetails = { channel: origin };
  const time = new Date(entry.at).toISOString();
  const base = {
    origin,
    originDetails,
    externalId: entry.id,
    start: time,
    end: null,
    details: { text: entry.text ?? '', createdAt: entry.createdAt ?? null },
  };
  const observation = (metric, value) => [{ origin, originDetails, metric, time, value }];

  switch (entry.kind) {
    case 'water':
      return {
        mode: 'exact',
        observations: observation('intake.water', entry.value),
        episodes: [
          {
            ...base,
            kind: 'drink',
            title: 'Agua',
            summary: { waterMl: entry.value },
            schema: 'drink@1',
          },
        ],
      };
    case 'drink': {
      const caffeineMg = entry.caffeineMg > 0 ? entry.caffeineMg : null;
      return {
        mode: 'exact',
        observations: [
          ...observation('intake.beverages', entry.value),
          ...(caffeineMg ? observation('intake.caffeine', caffeineMg) : []),
        ],
        episodes: [
          {
            ...base,
            kind: 'drink',
            title: entry.text || 'Bebida',
            summary: { fluidMl: entry.value, ...(caffeineMg && { caffeineMg }) },
            schema: 'drink@1',
          },
        ],
      };
    }
    case 'coffee':
      return {
        mode: 'exact',
        observations: observation('intake.caffeine', entry.value),
        episodes: [
          {
            ...base,
            kind: 'drink',
            title: 'Café',
            summary: { caffeineMg: entry.value },
            schema: 'drink@1',
          },
        ],
      };
    case 'weight':
      return {
        mode: 'exact',
        observations: observation('body.weight', entry.value),
        episodes: [
          {
            ...base,
            kind: 'weigh-in',
            title: `${entry.value} kg`,
            summary: { weight: entry.value, bodyFat: null },
            schema: 'weigh-in@1',
            details: { ...base.details, weight: entry.value, manual: true },
          },
        ],
      };
    case 'period':
      return {
        mode: 'exact',
        observations: [],
        episodes: [
          {
            ...base,
            kind: 'period',
            end: new Date(entry.endAt).toISOString(),
            title: entry.text || PERIOD_TITLES[entry.periodType] || 'Periodo',
            summary: { type: entry.periodType, from: entry.from, to: entry.to },
            schema: 'period@1',
          },
        ],
      };
    case 'symptom':
      return {
        mode: 'exact',
        observations: [],
        episodes: [
          {
            ...base,
            kind: 'symptom',
            title: entry.text || 'Síntoma',
            summary: { intensity: entry.value ?? null },
            schema: 'symptom@1',
          },
        ],
      };
    case 'medication':
      return {
        mode: 'exact',
        observations: [],
        episodes: [
          {
            ...base,
            kind: 'medication',
            title: entry.text,
            summary: { dose: entry.dose ?? null },
            schema: 'medication@1',
          },
        ],
      };
    case 'supplement':
      return {
        mode: 'exact',
        observations: [],
        episodes: [
          {
            ...base,
            kind: 'supplement',
            title: entry.text,
            summary: { dose: entry.dose ?? null, supplementId: entry.supplementId ?? null },
            schema: 'supplement@1',
          },
        ],
      };
    case 'note':
      return {
        mode: 'exact',
        observations: [],
        episodes: [
          { ...base, kind: 'note', title: entry.text || 'Nota', summary: {}, schema: 'note@1' },
        ],
      };
    default:
      return { mode: 'exact', observations: [], episodes: [] };
  }
}
