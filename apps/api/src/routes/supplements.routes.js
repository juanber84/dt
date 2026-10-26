import { Router } from 'express';
import { z } from 'zod';
import { SUPPLEMENT_TIMINGS, SUPPLEMENT_TYPES } from '@digitaltwin/engine';
import { validate } from '../middlewares/validate.js';
import { HttpError } from '../utils/http-error.js';

const fields = {
  name: z.string().trim().min(1).max(60),
  type: z.enum(SUPPLEMENT_TYPES),
  dose: z.string().trim().max(40).nullable(),
  timing: z.enum(SUPPLEMENT_TIMINGS).nullable(),
  startedOn: z.iso.date(),
  stoppedOn: z.iso.date().nullable(),
};
const notBeforeStart = (s) => !s.stoppedOn || !s.startedOn || s.stoppedOn >= s.startedOn;
const message = 'No puede dejarse antes de empezar';

const createBody = z
  .object({
    ...fields,
    type: fields.type.default('other'),
    dose: fields.dose.optional(),
    timing: fields.timing.optional(),
    stoppedOn: fields.stoppedOn.optional(),
  })
  .refine(notBeforeStart, { message, path: ['stoppedOn'] });
const updateBody = z
  .object(fields)
  .partial()
  .refine(notBeforeStart, { message, path: ['stoppedOn'] });
const idParams = z.object({ id: z.uuid() });

/**
 * /api/v1/supplements (con sesión): los suplementos habituales (Ajustes) y los chips de Hoy. Las
 * tomas se apuntan aparte, en /entries con kind 'supplement'.
 * @param {{ supplements: ReturnType<typeof import('@digitaltwin/engine').createSupplements> }} deps
 */
export function createSupplementsRouter({ supplements }) {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json({ items: await supplements.list(req.user.id) });
  });

  router.post('/', validate({ body: createBody }), async (req, res) => {
    res.status(201).json(await supplements.create(req.user.id, req.validated.body));
  });

  router.patch('/:id', validate({ params: idParams, body: updateBody }), async (req, res) => {
    const { id } = req.validated.params;
    const current = await supplements.get(req.user.id, id);
    if (!current) throw HttpError.notFound('No existe ese suplemento');
    // Las fechas, contra lo que ya hay (puede cambiar solo una de las dos)
    if (!notBeforeStart({ ...current, ...req.validated.body })) throw HttpError.badRequest(message);
    res.json(await supplements.update(req.user.id, id, req.validated.body));
  });

  router.delete('/:id', validate({ params: idParams }), async (req, res) => {
    const removed = await supplements.remove(req.user.id, req.validated.params.id);
    if (!removed) throw HttpError.notFound('No existe ese suplemento');
    res.status(204).end();
  });

  return router;
}
