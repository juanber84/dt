import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middlewares/validate.js';

const listQuery = z.object({
  source: z.string().max(40).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  /** Con raw=true se incluye el registro tal cual lo mandó la fuente. */
  raw: z.stringbool().default(false),
});

/** GET /api/v1/measurements: las mediciones del usuario de la sesión. */
export function createMeasurementsRouter({ measurements }) {
  const router = Router();
  router.get('/', validate({ query: listQuery }), async (req, res) => {
    const { raw, ...filters } = req.validated.query;
    const items = await measurements.list(req.user.id, filters);
    res.json({ items: raw ? items : items.map(({ raw: _raw, ...m }) => m) });
  });
  return router;
}
