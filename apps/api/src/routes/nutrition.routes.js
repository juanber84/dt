import { Router } from 'express';
import { z } from 'zod';
import { mealEntrySchema } from '@digitaltwin/nutrition';
import { validate } from '../middlewares/validate.js';
import { createNutritionController } from '../controllers/nutrition.controller.js';

const analyzeBody = z
  .object({
    text: z.string().max(4000).default(''),
    image: z
      .object({
        base64: z.string().min(1),
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
      })
      .optional(),
    /** Momento del mensaje: hora por defecto de lo que se ha comido. */
    now: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((body) => body.text.trim() || body.image, { message: 'Hace falta texto o imagen' });

const refineBody = z.object({
  /** La conversación que devolvió /analyze (o el /refine anterior). */
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
      }),
    )
    .min(2),
  correction: z.string().trim().min(1).max(4000),
});

export function createNutritionRouter({ analyzer }) {
  const router = Router();
  const controller = createNutritionController({ analyzer });

  router.post('/analyze', validate({ body: analyzeBody }), controller.analyze);
  router.post('/refine', validate({ body: refineBody }), controller.refine);
  router.post('/entries', validate({ body: mealEntrySchema }), controller.createEntry);

  return router;
}
