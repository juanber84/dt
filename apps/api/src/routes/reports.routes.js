import { Router } from 'express';
import { z } from 'zod';
import { EmailError } from '@digitaltwin/email';
import { validate } from '../middlewares/validate.js';
import { HttpError } from '../utils/http-error.js';

const settingsBody = z.object({
  dailyEnabled: z.boolean().optional(),
  dailyTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM')
    .optional(),
});

const idParams = z.object({ id: z.uuid() });

/**
 * /api/v1/reports (con sesión): los informes del usuario y sus preferencias (el de la mañana: si
 * lo quiere y a qué hora). POST /daily hace el de ayer al momento y lo manda por correo (para
 * probarlo o si quieres verlo antes de su hora).
 * @param {{ reports: ReturnType<typeof import('@digitaltwin/reports').createReports> }} deps
 */
export function createReportsRouter({ reports }) {
  const router = Router();
  const { store } = reports;

  router.get('/', async (req, res) => {
    res.json({ items: await store.list(req.user.id) });
  });

  router.get('/settings', async (req, res) => {
    res.json(await store.settings(req.user.id));
  });

  router.put('/settings', validate({ body: settingsBody }), async (req, res) => {
    const next = { ...(await store.settings(req.user.id)), ...req.validated.body };
    await store.saveSettings(req.user.id, next);
    res.json(next);
  });

  router.post('/daily', async (req, res) => {
    const report = await reports.daily({ userId: req.user.id, userName: req.user.name });
    let email;
    try {
      email = await reports.sendDaily(report, {
        userId: req.user.id,
        to: req.user.email,
        force: true,
      });
    } catch (err) {
      if (!(err instanceof EmailError)) throw err;
      email = { status: 'failed', error: err.message };
    }
    res.status(201).json({ id: report.id, title: report.title, email });
  });

  router.get('/:id', validate({ params: idParams }), async (req, res) => {
    const report = await store.get(req.user.id, req.validated.params.id);
    if (!report) throw HttpError.notFound('Ese informe no existe');
    res.json(report);
  });

  return router;
}
