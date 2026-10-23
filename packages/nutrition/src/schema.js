import { z } from 'zod';

const grams = z.number().nonnegative();

/** Qué comida del día es cada plato. El orden es el del día. */
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

/** Un ingrediente (o alimento suelto) con sus macros para la cantidad tomada. */
export const ingredientSchema = z.object({
  name: z.string().trim().min(1),
  quantity: z.number().nonnegative().nullable(),
  unit: z.string().trim(),
  kcal: grams,
  proteinG: grams,
  carbsG: grams,
  fatG: grams,
  fiberG: grams,
  /** Bebidas (y caldos): ml de líquido que hidrata; el alcohol no cuenta. Sin él, nada. */
  fluidMl: grams.optional(),
  caffeineMg: grams.optional(),
});

/** Un plato (primero, postre, bocadillo, café...) con su hora y sus ingredientes. */
export const dishSchema = z.object({
  name: z.string().trim().min(1),
  /** Instante en que se tomó (ISO 8601 en UTC). */
  eatenAt: z.iso.datetime({ offset: true }),
  /** Qué comida del día fue. Las antiguas no lo llevan. */
  mealType: z.enum(MEAL_TYPES).optional(),
  items: z.array(ingredientSchema).min(1),
});

/** Lo que se envía a la API al confirmar: lo que escribió el usuario + los platos estimados. */
export const mealEntrySchema = z.object({
  id: z.uuid(),
  source: z.string().trim().min(1),
  text: z.string(),
  notes: z.string().default(''),
  dishes: z.array(dishSchema).min(1),
  createdAt: z.iso.datetime({ offset: true }),
});

const macro = z.coerce.number().nonnegative().catch(0);

/** Lo que devuelve el modelo (snake_case, hora local). Tolerante con números como texto. */
export const modelOutputSchema = z.object({
  dishes: z.array(
    z.object({
      name: z.string().trim().min(1),
      eaten_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/),
      meal_type: z.enum(MEAL_TYPES).nullable().catch(null).default(null),
      items: z
        .array(
          z.object({
            name: z.string().trim().min(1),
            quantity: z.coerce.number().nonnegative().nullable().catch(null),
            unit: z.string().trim().catch(''),
            kcal: macro,
            protein_g: macro,
            carbs_g: macro,
            fat_g: macro,
            fiber_g: macro,
            fluid_ml: macro,
            caffeine_mg: macro,
          }),
        )
        .min(1),
    }),
  ),
  // Agua sola (no café, ni refrescos: eso son platos). ml null si no dice cuánta
  water: z
    .array(
      z.object({
        ml: z.coerce.number().positive().max(5000).nullable().catch(null),
        drunk_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/),
      }),
    )
    .catch([])
    .default([]),
  // Medicamentos y suplementos que se toma (no son comida): nombre, dosis si la dice y hora
  medications: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        dose: z.string().trim().catch(''),
        taken_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/),
      }),
    )
    .catch([])
    .default([]),
  // Lo que hay que preguntar antes de apuntar (cuánta agua...). Vacío si está todo claro
  question: z.string().catch('').default(''),
  notes: z.string().catch(''),
});
