import { PgBoss } from 'pg-boss';

/**
 * Trabajos del pipeline. Cualquier entrada (webhook, cron, botón, bot) acaba en uno de estos:
 *
 *   sync            ve a la fuente y trae lo nuevo de un usuario     { userId, provider, from?, to?, reason }
 *   backfill        carga inicial: planifica los trozos del histórico { userId, provider }
 *   fetch           descarga un trozo concreto (Google: tipo + rango)  { userId, provider, kind, from, to, backfillId? }
 *   normalize       raw_record → observations/episodes                 { rawId }
 *   scheduled-sync  lo lanza el cron: un sync por cada conexión         { provider }
 *   maintenance     limpieza diaria (buzón, contadores)                 {}
 *   clinical-extract  un PDF subido → texto, sin datos personales, LLM   { documentId }
 *   google-subscriber deja el suscriptor de webhooks de Google como toca  { force? }
 */
export const JOBS = Object.freeze({
  SYNC: 'sync',
  BACKFILL: 'backfill',
  FETCH: 'fetch',
  NORMALIZE: 'normalize',
  SCHEDULED_SYNC: 'scheduled-sync',
  MAINTENANCE: 'maintenance',
  CLINICAL_EXTRACT: 'clinical-extract',
  GOOGLE_SUBSCRIBER: 'google-subscriber',
});

/** Prioridad (mayor = antes): lo del día a día pasa por delante del histórico. */
export const PRIORITY = Object.freeze({ LIVE: 10, BACKFILL: 0 });

/**
 * Reintentos, caducidad y política de cada cola. Con `singletonKey` (usuario + proveedor):
 *   stately    sync: como mucho uno en marcha y otro esperando (los demás se descartan)
 *   exclusive  backfill: uno por conexión, en marcha o esperando
 */
const QUEUES = {
  [JOBS.SYNC]: {
    policy: 'stately',
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 600,
  },
  [JOBS.BACKFILL]: { policy: 'exclusive', retryLimit: 3, retryDelay: 60, retryBackoff: true },
  [JOBS.FETCH]: {
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 3600,
    expireInSeconds: 600,
  },
  [JOBS.NORMALIZE]: { retryLimit: 3, retryDelay: 10, retryBackoff: true },
  [JOBS.SCHEDULED_SYNC]: { retryLimit: 0 },
  [JOBS.MAINTENANCE]: { retryLimit: 1, policy: 'singleton' },
  // El LLM puede tardar o fallar (saldo, red): un par de reintentos y luego se marca el error
  [JOBS.CLINICAL_EXTRACT]: {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 600,
  },
  // Google verifica la URL al crear el suscriptor: al arrancar puede que el front o el túnel aún
  // no estén, así que reintenta con calma (hasta ~1 h)
  [JOBS.GOOGLE_SUBSCRIBER]: {
    policy: 'singleton',
    retryLimit: 8,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 900,
  },
};

/**
 * Cola sobre Postgres (pg-boss, schema `pgboss` de la misma BD).
 * La API solo encola (`worker: false`: sin mantenimiento ni cron); el worker hace todo.
 * @param {object} options
 * @param {string} options.connectionString
 * @param {boolean} [options.worker]  true en apps/worker: mantenimiento, cron y consumidores.
 * @param {import('pino').Logger} [options.logger]
 */
export function createQueue({ connectionString, worker = false, logger }) {
  const boss = new PgBoss({
    connectionString,
    application_name: worker ? 'digitaltwin-worker' : 'digitaltwin-api',
    max: worker ? 10 : 3,
    supervise: worker,
    schedule: worker,
    migrate: true,
  });
  boss.on('error', (err) => logger?.error({ err }, 'cola: error'));
  boss.on('warning', (warning) => logger?.warn({ warning }, 'cola: aviso'));

  return {
    async start() {
      await boss.start();
      const existing = new Set((await boss.getQueues()).map((q) => q.name));
      for (const [name, options] of Object.entries(QUEUES)) {
        // La política no se puede cambiar una vez creada la cola (habría que borrarla)
        const { policy, ...updatable } = options;
        void policy;
        if (existing.has(name)) await boss.updateQueue(name, updatable);
        else await boss.createQueue(name, options);
      }
    },
    /** @returns {Promise<string|null>} id del trabajo (null si un singleton/debounce lo absorbe) */
    send(name, data, options) {
      return boss.send(name, data, options);
    },
    /** Agrupa ráfagas (p. ej. varios avisos de Google seguidos): uno por `key` cada `seconds`. */
    sendDebounced(name, data, options, seconds, key) {
      return boss.sendDebounced(name, data, options ?? null, seconds, key);
    },
    /** Muchos de golpe (los trozos de un backfill). */
    insert(name, jobs) {
      return boss.insert(name, jobs);
    },
    /**
     * Un trabajo cada vez por handler (pg-boss entrega lotes: se procesan uno a uno). El handler
     * recibe { id, data, retryCount, retryLimit } (para saber si es el último intento).
     * burstWhenReadyExceeds 1: mientras quede trabajo se encadena sin esperar; sin él pg-boss
     * espera el intervalo de sondeo (2 s) entre trabajo y trabajo y una cola larga no baja.
     */
    work(name, options, handler) {
      const defaults = { batchSize: 1, includeMetadata: true, burstWhenReadyExceeds: 1 };
      return boss.work(name, { ...defaults, ...options }, async ([job]) =>
        handler({
          id: job.id,
          data: job.data,
          retryCount: job.retryCount,
          retryLimit: job.retryLimit,
        }),
      );
    },
    schedule(name, cron, data, options) {
      return boss.schedule(name, cron, data, options);
    },
    cancel(name, ids) {
      return boss.cancel(name, ids);
    },
    /**
     * Cuántos trabajos hay en cada cola (pg-boss lo cachea: puede ir ~1 min por detrás).
     * @returns {Promise<Record<string, { ready: number, deferred: number, active: number, failed: number }>>}
     */
    async stats() {
      const queues = await boss.getQueues(Object.values(JOBS));
      return Object.fromEntries(
        queues.map((q) => [
          q.name,
          {
            ready: q.readyCount ?? 0,
            deferred: q.deferredCount ?? 0,
            active: q.activeCount ?? 0,
            failed: q.failedCount ?? 0,
          },
        ]),
      );
    },
    stop() {
      return boss.stop({ graceful: true, timeout: 20_000 });
    },
  };
}

/**
 * Misma interfaz en memoria, para tests y para correr sin BD. Los trabajos se quedan en `jobs`
 * hasta que se llama a `drain()`, que los pasa por los handlers registrados con `work`
 * (incluidos los que vayan encolando por el camino).
 */
export function createMemoryQueue() {
  const handlers = new Map();
  const jobs = [];
  let seq = 0;

  const queue = {
    jobs,
    async start() {},
    async stop() {},
    async send(name, data, options = {}) {
      if (
        options.singletonKey &&
        jobs.some((j) => j.name === name && j.key === options.singletonKey)
      ) {
        return null;
      }
      const id = `job-${++seq}`;
      jobs.push({ id, name, data, options, key: options.singletonKey });
      return id;
    },
    async sendDebounced(name, data, options, _seconds, key) {
      return queue.send(name, data, { ...options, singletonKey: key ?? options?.singletonKey });
    },
    async insert(name, list) {
      const ids = [];
      for (const { data, ...options } of list) ids.push(await queue.send(name, data, options));
      return ids;
    },
    async work(name, _options, handler) {
      handlers.set(name, handler);
      return name;
    },
    async schedule() {},
    async stats() {
      const out = {};
      for (const name of Object.values(JOBS))
        out[name] = { ready: 0, deferred: 0, active: 0, failed: 0 };
      for (const job of jobs)
        (out[job.name] ??= { ready: 0, deferred: 0, active: 0, failed: 0 }).ready++;
      return out;
    },
    async cancel(name, ids) {
      const set = new Set([ids].flat());
      for (let i = jobs.length - 1; i >= 0; i--) {
        if (jobs[i].name === name && set.has(jobs[i].id)) jobs.splice(i, 1);
      }
    },
    /**
     * Procesa lo pendiente (en orden de prioridad) y devuelve los trabajos ejecutados. Con `limit`
     * para después de esos; sin él sigue hasta vaciar (y corta si parece un bucle).
     */
    async drain({ limit } = {}) {
      const done = [];
      while (jobs.length) {
        if (limit !== undefined && done.length >= limit) break;
        if (done.length >= 10_000) throw new Error('drain: demasiados trabajos (¿bucle?)');
        jobs.sort((a, b) => (b.options.priority ?? 0) - (a.options.priority ?? 0));
        const job = jobs.shift();
        const handler = handlers.get(job.name);
        if (!handler) throw new Error(`drain: no hay handler para ${job.name}`);
        // Sin reintentos: cada trabajo es su último intento
        await handler({ id: job.id, data: job.data, retryCount: 0, retryLimit: 0 });
        done.push(job);
      }
      return done;
    },
  };
  return queue;
}
