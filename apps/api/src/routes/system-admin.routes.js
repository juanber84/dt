import { Router } from 'express';
import { z } from 'zod';

const query = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  failed: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  name: z
    .string()
    .regex(/^[a-z-]+$/)
    .optional(),
});

/**
 * /api/v1/admin/system (solo admin): qué ha llegado de fuera (buzón) y qué ha hecho el worker
 * (historial de la cola). Solo lee lo que ya se guarda: no apunta nada nuevo.
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createTimelineStore>} deps.store
 */
export function createSystemAdminRouter({ store }) {
  const router = Router();

  router.get('/activity', async (req, res) => {
    const parsed = query.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Parámetros no válidos' });
    const { limit, failed, name } = parsed.data;
    const [inbox, jobs, counts] = await Promise.all([
      store.recentInbox({ limit: Math.min(limit, 15) }),
      store.recentJobs({ limit, failed, name }),
      store.jobCounts({ hours: 24 }),
    ]);
    res.json({ inbox, jobs, counts });
  });

  return router;
}
