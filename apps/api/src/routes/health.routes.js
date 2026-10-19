import { Router } from 'express';
import { liveness, createReadiness } from '../controllers/health.controller.js';

export function createHealthRouter({ db, heartbeats, queue, pipeline } = {}) {
  const router = Router();
  router.get('/', liveness);
  router.get('/ready', createReadiness({ db, heartbeats, queue, pipeline }));
  return router;
}
