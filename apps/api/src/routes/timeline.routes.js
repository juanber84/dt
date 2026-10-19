import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middlewares/validate.js';

const DAY_MS = 24 * 3600 * 1000;
const range = {
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
};
const list = z
  .string()
  .max(2000)
  .transform((value) =>
    value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  );

const seriesQuery = z
  .object({
    ...range,
    bucket: z.enum(['hour', 'day']).default('day'),
    metrics: list.optional(),
    tz: z.string().max(64).optional(),
  })
  // Por hora como mucho 93 días; por día, 10 años
  .refine(
    (q) => Date.parse(q.to) - Date.parse(q.from) <= (q.bucket === 'hour' ? 93 : 3660) * DAY_MS,
    { message: 'Rango demasiado grande para ese bucket' },
  );
const episodesQuery = z.object({
  ...range,
  kinds: list.optional(),
  // all=true: también las comidas que tapa una fuente con más prioridad
  all: z.enum(['true', 'false']).default('false'),
  tz: z.string().max(64).optional(),
});
const observationsQuery = z
  .object({ ...range, metric: z.string().min(1).max(80) })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 7 * DAY_MS, {
    message: 'Los datos crudos se piden como mucho de 7 en 7 días',
  });

/**
 * /api/v1/timeline: el timeline normalizado del usuario de la sesión.
 *   GET /metrics       métricas con datos (y desde cuándo)
 *   GET /series        valor canónico por hora o día (la fuente que manda en cada tramo)
 *   GET /episodes      comidas, entrenos, sueño, pesajes... con su detalle
 *   GET /observations  datos crudos de una métrica de todas las fuentes (zoom)
 */
export function createTimelineRouter({ queries, timeZone }) {
  const router = Router();
  const dates = (q) => ({ from: new Date(q.from), to: new Date(q.to) });

  router.get('/metrics', async (req, res) => {
    res.json({ items: await queries.availableMetrics(req.user.id) });
  });

  router.get('/series', validate({ query: seriesQuery }), async (req, res) => {
    const q = req.validated.query;
    res.json({
      bucket: q.bucket,
      timeZone: q.tz ?? timeZone,
      series: await queries.series({
        userId: req.user.id,
        ...dates(q),
        bucket: q.bucket,
        metrics: q.metrics,
        timeZone: q.tz ?? timeZone,
      }),
    });
  });

  router.get('/episodes', validate({ query: episodesQuery }), async (req, res) => {
    const q = req.validated.query;
    res.json({
      items: await queries.episodes({
        userId: req.user.id,
        ...dates(q),
        kinds: q.kinds,
        canonical: q.all !== 'true',
        timeZone: q.tz ?? timeZone,
      }),
    });
  });

  router.get('/observations', validate({ query: observationsQuery }), async (req, res) => {
    const q = req.validated.query;
    res.json({
      items: await queries.observations({ userId: req.user.id, ...dates(q), metric: q.metric }),
    });
  });

  return router;
}
