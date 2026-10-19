import { ping } from '@digitaltwin/db';

const startedAt = new Date();

export function liveness(_req, res) {
  res.json({ status: 'ok' });
}

/**
 * @param {object} [deps]
 * @param {import('postgres').Sql} [deps.db]  Sin db, no se comprueba.
 * @param {ReturnType<typeof import('../services/heartbeats.js').createHeartbeats>} [deps.heartbeats]
 *   Servicios que avisan de que siguen vivos (el bot). Informativo: no cambia el 200/503.
 * @param {ReturnType<typeof import('@digitaltwin/queue').createQueue>} [deps.queue]
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createPipeline>} [deps.pipeline]
 *   Con ellos se informa del worker (su latido en la BD) y de cuántos trabajos hay en cada cola.
 *   También informativo: la API está lista aunque el worker no lo esté.
 */
export function createReadiness({ db, heartbeats, queue, pipeline } = {}) {
  return async (req, res) => {
    const checks = {};
    if (db) {
      try {
        await ping(db);
        checks.db = 'ok';
      } catch (err) {
        req.log?.warn({ err }, 'La BD no responde');
        checks.db = 'down';
      }
    }
    const ok = Object.values(checks).every((status) => status === 'ok');
    const services = heartbeats?.snapshot() ?? {};
    let queues;
    if (pipeline && checks.db === 'ok') {
      try {
        const workers = await pipeline.store.workerHeartbeats();
        // El que más recientemente ha latido; si hay varios, la lista completa va aparte
        if (workers.length) services.worker = { ...workers[0], instances: workers.length };
        queues = await queue?.stats();
      } catch (err) {
        req.log?.warn({ err }, 'No se pudo leer el estado del worker');
      }
    }
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      checks,
      services,
      ...(queues && { queues }),
      uptime: process.uptime(),
      startedAt: startedAt.toISOString(),
      version: process.env.npm_package_version ?? '0.1.0',
    });
  };
}
