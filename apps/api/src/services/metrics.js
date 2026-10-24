import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';

/**
 * Métricas en formato Prometheus para Grafana (las recoge digitaltwin-alloy de /metrics, que no
 * pasa por nginx). Sin datos de salud ni ids de usuario: solo cuánto, cuánto tarda y si va bien.
 *
 * - Peticiones HTTP: por método, ruta (la plantilla, no la URL) y código.
 * - Al leerlas: colas de pg-boss, latido del worker y del bot, contadores de trabajos del worker y
 *   la última copia de seguridad.
 * - Las del proceso de Node (memoria, event loop, GC).
 *
 * @param {object} [deps]
 * @param {ReturnType<typeof import('./heartbeats.js').createHeartbeats>} [deps.heartbeats]
 * @param {ReturnType<typeof import('@digitaltwin/queue').createQueue>} [deps.queue]
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createPipeline>} [deps.pipeline]
 * @param {import('pino').Logger} [deps.logger]
 * @param {() => number} [deps.now]
 */
export function createMetrics({ heartbeats, queue, pipeline, logger, now = Date.now } = {}) {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'digitaltwin_api_' });

  const httpDuration = new Histogram({
    name: 'digitaltwin_http_request_duration_seconds',
    help: 'Duración de las peticiones a la API',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [registry],
  });

  const queueJobs = new Gauge({
    name: 'digitaltwin_queue_jobs',
    help: 'Trabajos en cada cola de pg-boss por estado (va ~1 min por detrás)',
    labelNames: ['queue', 'state'],
    registers: [registry],
  });
  const serviceUp = new Gauge({
    name: 'digitaltwin_service_up',
    help: '1 si el servicio (worker, bot) late a tiempo, 0 si ha perdido tres latidos',
    labelNames: ['service'],
    registers: [registry],
  });
  const serviceAge = new Gauge({
    name: 'digitaltwin_service_last_seen_seconds',
    help: 'Segundos desde el último latido del servicio',
    labelNames: ['service'],
    registers: [registry],
  });
  // Counter y no Gauge: el worker los cuenta desde que arrancó, así que vuelven a 0 al
  // reiniciarse, que es justo lo que rate()/increase() de Prometheus saben tratar
  const workerJobs = new Counter({
    name: 'digitaltwin_worker_jobs_total',
    help: 'Trabajos del worker desde que arrancó, por cola y resultado',
    labelNames: ['queue', 'result'],
    registers: [registry],
  });
  const backupLast = new Gauge({
    name: 'digitaltwin_backup_last_success_timestamp_seconds',
    help: 'Cuándo acabó bien la última copia de seguridad (epoch)',
    registers: [registry],
  });
  const backupSize = new Gauge({
    name: 'digitaltwin_backup_last_size_bytes',
    help: 'Tamaño de la última copia de seguridad buena',
    registers: [registry],
  });
  const backupFailed = new Gauge({
    name: 'digitaltwin_backup_last_failed',
    help: '1 si la última copia de seguridad acabó en error',
    registers: [registry],
  });
  const scrapeErrors = new Counter({
    name: 'digitaltwin_metrics_errors_total',
    help: 'Fallos leyendo el estado al servir /metrics',
    labelNames: ['source'],
    registers: [registry],
  });

  /** Lo último que se publicó de cada contador del worker (para sumar solo la diferencia). */
  let workerSeen = { startedAt: null, counts: {} };

  function setService(name, info) {
    serviceUp.set({ service: name }, info.status === 'ok' ? 1 : 0);
    serviceAge.set({ service: name }, Math.max(0, (now() - Date.parse(info.lastSeenAt)) / 1000));
  }

  /** Pasa los contadores del worker (absolutos desde su arranque) a Counter de Prometheus. */
  function setWorkerJobs(worker) {
    if (worker.startedAt !== workerSeen.startedAt) {
      // Worker nuevo: sus contadores empiezan de cero, y los nuestros también
      workerJobs.reset();
      workerSeen = { startedAt: worker.startedAt, counts: {} };
    }
    for (const [name, counts] of Object.entries(worker.stats?.jobs ?? {})) {
      for (const result of ['done', 'failed', 'postponed']) {
        const key = `${name}:${result}`;
        const delta = (counts[result] ?? 0) - (workerSeen.counts[key] ?? 0);
        if (delta > 0) workerJobs.inc({ queue: name, result }, delta);
        else if (!(key in workerSeen.counts)) workerJobs.inc({ queue: name, result }, 0);
        workerSeen.counts[key] = counts[result] ?? 0;
      }
    }
  }

  async function refresh() {
    serviceUp.reset();
    serviceAge.reset();
    for (const [name, info] of Object.entries(heartbeats?.snapshot() ?? {})) setService(name, info);

    if (queue) {
      try {
        const stats = await queue.stats();
        queueJobs.reset();
        for (const [name, counts] of Object.entries(stats))
          for (const [state, value] of Object.entries(counts))
            queueJobs.set({ queue: name, state }, value);
      } catch (err) {
        scrapeErrors.inc({ source: 'queue' });
        logger?.warn({ err }, 'No se pudo leer el estado de las colas para /metrics');
      }
    }

    if (pipeline) {
      try {
        const [worker] = await pipeline.store.workerHeartbeats();
        // Sin latido en el último día no hay fila: el worker cuenta como caído
        if (worker) {
          setService('worker', worker);
          setWorkerJobs(worker);
        } else serviceUp.set({ service: 'worker' }, 0);
      } catch (err) {
        scrapeErrors.inc({ source: 'worker' });
        logger?.warn({ err }, 'No se pudo leer el latido del worker para /metrics');
      }
      try {
        const backups = await pipeline.store.recentBackups({ limit: 10 });
        const finished = backups.find((b) => b.status !== 'running');
        const lastOk = backups.find((b) => b.status === 'ok');
        backupFailed.set(finished?.status === 'error' ? 1 : 0);
        if (lastOk) {
          backupLast.set(Date.parse(lastOk.finishedAt) / 1000);
          if (lastOk.sizeBytes != null) backupSize.set(lastOk.sizeBytes);
        }
      } catch (err) {
        scrapeErrors.inc({ source: 'backup' });
        logger?.warn({ err }, 'No se pudo leer la última copia para /metrics');
      }
    }
  }

  return {
    registry,

    /** Middleware: mide cada petición al acabar. */
    httpMiddleware(req, res, next) {
      const end = httpDuration.startTimer();
      res.on('finish', () => {
        // La plantilla de la ruta (/api/v1/clinical/documents/:id), no la URL: si no, cada id
        // sería una serie nueva. Lo que no casa con ninguna ruta va junto.
        const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
        end({ method: req.method, route, status: String(res.statusCode) });
      });
      next();
    },

    /** Handler de GET /metrics. */
    async handler(_req, res) {
      await refresh();
      res.set('Content-Type', registry.contentType);
      res.send(await registry.metrics());
    },
  };
}
