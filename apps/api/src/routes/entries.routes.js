import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middlewares/validate.js';

const at = z.iso.datetime({ offset: true });
const text = z.string().trim().max(500);

// Un esquema por tipo: cada uno con su valor y sus límites razonables
const entryBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('water'), at, value: z.number().positive().max(5000) }),
  z.object({ kind: z.literal('coffee'), at, value: z.number().positive().max(1000) }),
  z.object({ kind: z.literal('weight'), at, value: z.number().min(20).max(400) }),
  z.object({
    kind: z.literal('symptom'),
    at,
    text: text.min(1),
    value: z.number().int().min(1).max(5).optional(),
  }),
  z.object({ kind: z.literal('note'), at, text: text.min(1) }),
]);

/**
 * /api/v1/entries (con sesión): apuntar a mano agua, café, peso, síntomas y notas, y borrarlos.
 * @param {{ entries: ReturnType<typeof import('../services/entries.js').createEntries> }} deps
 */
export function createEntriesRouter({ entries }) {
  const router = Router();

  router.post('/', validate({ body: entryBody }), async (req, res) => {
    res.status(201).json(await entries.add(req.user.id, req.validated.body));
  });

  router.delete('/:id', async (req, res) => {
    await entries.remove(req.user.id, req.params.id);
    res.status(204).end();
  });

  return router;
}
