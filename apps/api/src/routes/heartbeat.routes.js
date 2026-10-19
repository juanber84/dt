import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middlewares/validate.js';

const heartbeatBody = z.object({
  /** Cada cuánto late: con eso la API decide cuándo darlo por caído. */
  intervalMs: z.int().min(1000).max(3_600_000),
  startedAt: z.iso.datetime({ offset: true }),
  version: z.string().max(40).optional(),
  /** Usuario del bot en Telegram (sin @). */
  username: z.string().max(64).optional(),
});

/** POST /api/v1/heartbeat: el servicio es el cliente de la API key que llama. */
export function createHeartbeatRouter({ heartbeats }) {
  const router = Router();
  router.post('/', validate({ body: heartbeatBody }), (req, res) => {
    heartbeats.beat(req.apiClient, req.validated.body);
    res.status(204).end();
  });
  return router;
}
