import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { entrySchema } from '../services/entries.js';

/**
 * /api/v1/entries (con sesión): apuntar a mano agua, café, peso, síntomas y notas, y borrarlos.
 * @param {{ entries: ReturnType<typeof import('../services/entries.js').createEntries> }} deps
 */
export function createEntriesRouter({ entries }) {
  const router = Router();

  router.post('/', validate({ body: entrySchema }), async (req, res) => {
    res.status(201).json(await entries.add(req.user.id, req.validated.body));
  });

  router.delete('/:id', async (req, res) => {
    await entries.remove(req.user.id, req.params.id);
    res.status(204).end();
  });

  return router;
}
