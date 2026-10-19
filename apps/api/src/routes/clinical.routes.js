import express, { Router } from 'express';
import { z } from 'zod';
import { metricOptions } from '@digitaltwin/clinical';
import { validate } from '../middlewares/validate.js';

const idParams = z.object({ id: z.uuid() });
const uploadQuery = z.object({
  name: z.string().trim().min(1).max(200).default('informe.pdf'),
  // El día desde el que se sube: si el informe no trae fecha, va ahí
  date: z.iso.date().optional(),
});
// La extracción la valida (y recalcula) el servicio con el esquema de @digitaltwin/clinical
const extractionBody = z.object({ extraction: z.record(z.string(), z.unknown()) });
const confirmBody = z.object({ extraction: z.record(z.string(), z.unknown()).optional() });

/**
 * /api/v1/clinical: informes médicos del usuario de la sesión.
 *   GET    /documents              lista (sin el PDF)
 *   POST   /documents?name=x.pdf&date=YYYY-MM-DD
 *                                  sube un PDF (body: application/pdf); 201 nuevo, 200 si ya estaba
 *   GET    /documents/:id          detalle con lo extraído
 *   PUT    /documents/:id          guarda lo corregido en la revisión
 *   POST   /documents/:id/confirm  lo confirma (al timeline)
 *   POST   /documents/:id/retry    vuelve a leer el PDF
 *   DELETE /documents/:id          lo borra (y lo que generó en el timeline)
 *   GET    /parameters             evolución de cada parámetro
 *   GET    /metrics                métricas que se pueden asignar al revisar
 */
export function createClinicalRouter({ clinical, uploadLimit }) {
  const router = Router();
  const raw = express.raw({
    type: ['application/pdf', 'application/octet-stream'],
    limit: uploadLimit,
  });

  router.get('/documents', async (req, res) => {
    res.json({ items: await clinical.list(req.user.id) });
  });

  router.post('/documents', raw, validate({ query: uploadQuery }), async (req, res) => {
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const { document, created } = await clinical.upload(req.user.id, {
      fileName: req.validated.query.name,
      requestedDate: req.validated.query.date ?? null,
      data,
    });
    res.status(created ? 201 : 200).json({ document, created });
  });

  router.get('/documents/:id', validate({ params: idParams }), async (req, res) => {
    res.json(await clinical.get(req.user.id, req.validated.params.id));
  });

  router.put(
    '/documents/:id',
    validate({ params: idParams, body: extractionBody }),
    async (req, res) => {
      const { id } = req.validated.params;
      res.json(await clinical.update(req.user.id, id, req.validated.body.extraction));
    },
  );

  router.post(
    '/documents/:id/confirm',
    validate({ params: idParams, body: confirmBody }),
    async (req, res) => {
      const { id } = req.validated.params;
      res.json(await clinical.confirm(req.user.id, id, req.validated.body.extraction));
    },
  );

  router.post('/documents/:id/retry', validate({ params: idParams }), async (req, res) => {
    res.status(202).json(await clinical.retry(req.user.id, req.validated.params.id));
  });

  router.delete('/documents/:id', validate({ params: idParams }), async (req, res) => {
    await clinical.remove(req.user.id, req.validated.params.id);
    res.status(204).end();
  });

  router.get('/parameters', async (req, res) => {
    res.json({ items: await clinical.parameters(req.user.id) });
  });

  router.get('/metrics', (_req, res) => {
    res.json({ items: metricOptions() });
  });

  return router;
}
