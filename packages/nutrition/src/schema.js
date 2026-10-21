import { z } from 'zod';

const grams = z.number().nonnegative();

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
});

/** Un plato (primero, postre, bocadillo, café...) con su hora y sus ingredientes. */
export const dishSchema = z.object({
  name: z.string().trim().min(1),
  /** Instante en que se tomó (ISO 8601 en UTC). */
  eatenAt: z.iso.datetime({ offset: true }),
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
  // Lo que hay que preguntar antes de apuntar (cuánta agua...). Vacío si está todo claro
  question: z.string().catch('').default(''),
  notes: z.string().catch(''),
});
