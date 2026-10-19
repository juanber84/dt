import { JOBS, PRIORITY } from '@digitaltwin/queue';
import { RateLimitedError } from './rate-limit.js';
import { XIAOMI } from './providers/xiaomi.js';
import { INTERVALS } from './providers/intervals.js';
import { GOOGLE } from './providers/google.js';

const DAY_MS = 24 * 3600 * 1000;

/**
 * Registra los consumidores de cada cola y el cron.
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/queue').createQueue>} deps.queue
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createPipeline>} deps.pipeline
 * @param {ReturnType<typeof import('@digitaltwin/connections').createDbConnectionStore>} deps.connections
 * @param {{ xiaomi: ReturnType<typeof import('./providers/xiaomi.js').createXiaomiProvider>, intervals: ReturnType<typeof import('./providers/intervals.js').createIntervalsProvider>, google?: ReturnType<typeof import('./providers/google.js').createGoogleProvider> }} deps.providers
 * @param {ReturnType<typeof import('./clinical.js').createClinicalProcessor>} [deps.clinical]
 * @param {ReturnType<typeof import('./config/env.js').loadConfig>} deps.config
 * @param {() => number} [deps.now]
 * @param {import('pino').Logger} deps.logger
 */
export function createJobs({
  queue,
  pipeline,
  connections,
  providers,
  clinical,
  config,
  now = Date.now,
  logger,
}) {
  const { store } = pipeline;

  function provider(name) {
    if (name === XIAOMI) return providers.xiaomi;
    if (name === INTERVALS) return providers.intervals;
    if (name === GOOGLE && providers.google) return providers.google;
    return null;
  }

  /** Si la API de fuera pide esperar, el trabajo se vuelve a encolar para luego (no es un fallo). */
  // Contadores desde que arrancó (los enseña la página de Sistema con el latido)
  const counters = {};
  let lastError = null;
  const count = (name, field) => {
    const c = (counters[name] ??= { done: 0, failed: 0, postponed: 0 });
    c[field]++;
  };

  async function postpone(name, data, err) {
    count(name, 'postponed');
    logger.info(
      { provider: err.provider, retryAfter: err.retryAfterSeconds },
      'aplazado por límite',
    );
    await queue.send(name, data, {
      startAfter: err.retryAfterSeconds,
      priority: data.priority ?? PRIORITY.LIVE,
      ...(data.provider && { group: { id: data.provider } }),
    });
  }

  const handlers = {
    /** Trae lo nuevo de una conexión. */
    async [JOBS.SYNC]({ data }) {
      const { userId } = data;
      if (data.provider === XIAOMI)
        return providers.xiaomi.sync(userId, { priority: PRIORITY.LIVE });
      if (data.provider === INTERVALS)
        return providers.intervals.sync(userId, { priority: PRIORITY.LIVE });
      if (data.provider === GOOGLE && providers.google) {
        const connection = await connections.get(userId, GOOGLE);
        if (connection?.status !== 'connected') return { skipped: 'not-connected' };
        const to = data.to ? new Date(data.to) : new Date(now());
        const from = data.from
          ? new Date(data.from)
          : connection.lastSync
            ? new Date(Date.parse(connection.lastSync) - DAY_MS)
            : new Date(to.getTime() - 2 * DAY_MS);
        const jobs = await providers.google.plan(userId, { from, to, priority: PRIORITY.LIVE });
        const latest = (await connections.get(userId, GOOGLE)) ?? connection;
        await connections.save({ ...latest, lastSync: new Date(now()).toISOString() });
        return { jobs };
      }
      return { skipped: 'unsupported' };
    },

    /** Carga inicial de una conexión recién hecha. */
    async [JOBS.BACKFILL]({ data }) {
      const { userId } = data;
      if (!provider(data.provider)) return { skipped: 'unsupported' };
      const backfillId = await store.startBackfill(userId, data.provider);

      // Xiaomi e intervals.icu: el histórico entero cabe en un trabajo
      if (data.provider === XIAOMI || data.provider === INTERVALS) {
        await store.setBackfillTotal(backfillId, 1);
        try {
          const result = await provider(data.provider).sync(userId, {
            full: true,
            priority: PRIORITY.BACKFILL,
          });
          await store.backfillProgress(backfillId);
          return result;
        } catch (err) {
          await store.backfillProgress(backfillId, { failed: true });
          throw err;
        }
      }

      const to = new Date(now());
      const from = new Date(to.getTime() - config.GOOGLE_BACKFILL_DAYS * DAY_MS);
      const total = await providers.google.plan(userId, {
        from,
        to,
        chunkDays: config.GOOGLE_BACKFILL_CHUNK_DAYS,
        priority: PRIORITY.BACKFILL,
        backfillId,
      });
      await store.setBackfillTotal(backfillId, total);
      const connection = await connections.get(userId, GOOGLE);
      if (connection) await connections.save({ ...connection, lastSync: to.toISOString() });
      logger.info({ userId, provider: data.provider, total }, 'backfill planificado');
      return { backfillId, total };
    },

    /** Un trozo de descarga (Google). */
    async [JOBS.FETCH]({ data, retryCount, retryLimit }) {
      const { backfillId } = data;
      if (backfillId && !(await store.isBackfillActive(backfillId)))
        return { skipped: 'cancelled' };
      const target = provider(data.provider);
      if (!target?.fetch) return { skipped: 'unsupported' };
      try {
        const result = await target.fetch(data, { priority: data.priority });
        if (backfillId) await store.backfillProgress(backfillId);
        return result;
      } catch (err) {
        if (err instanceof RateLimitedError) return postpone(JOBS.FETCH, data, err);
        // Solo cuenta como fallido en el último intento
        if (backfillId && retryCount >= retryLimit) {
          await store.backfillProgress(backfillId, { failed: true });
        }
        throw err;
      }
    },

    async [JOBS.NORMALIZE]({ data }) {
      return pipeline.normalize(data.rawId);
    },

    /** El cron: un sync por cada conexión activa del proveedor. */
    async [JOBS.SCHEDULED_SYNC]({ data }) {
      const list = await connections.listByProvider(data.provider);
      for (const connection of list) {
        await queue.send(
          JOBS.SYNC,
          { userId: connection.userId, provider: data.provider, reason: 'cron' },
          { singletonKey: `${data.provider}:${connection.userId}`, priority: PRIORITY.LIVE },
        );
      }
      return { queued: list.length };
    },

    async [JOBS.MAINTENANCE]() {
      return store.cleanup();
    },

    /** Un informe médico subido: se lee y queda para revisar. */
    async [JOBS.CLINICAL_EXTRACT]({ data, retryCount, retryLimit }) {
      if (!clinical) return { skipped: 'unsupported' };
      return clinical.run(data, { last: retryCount >= retryLimit });
    },
  };

  /** Envuelve cada handler con logs y, en el sync, el aplazamiento por límite. */
  function wrap(name, handler) {
    return async (job) => {
      const started = Date.now();
      try {
        const result = await handler(job);
        logger.debug({ job: name, id: job.id, ms: Date.now() - started, result }, 'trabajo hecho');
        count(name, 'done');
        return result;
      } catch (err) {
        if (name === JOBS.SYNC && err instanceof RateLimitedError) {
          return postpone(name, job.data, err);
        }
        logger.warn({ job: name, id: job.id, err, data: job.data }, 'trabajo fallido');
        count(name, 'failed');
        lastError = {
          job: name,
          provider: job.data?.provider ?? null,
          message: String(err.message).slice(0, 300),
          at: new Date().toISOString(),
        };
        throw err;
      }
    };
  }

  return {
    handlers,

    /** Trabajos hechos, fallidos y aplazados por cola desde que arrancó, y el último error. */
    stats() {
      return { jobs: structuredClone(counters), lastError };
    },

    /** Consumidores con su concurrencia y el cron. */
    async start() {
      await queue.work(JOBS.SYNC, { localConcurrency: 2 }, wrap(JOBS.SYNC, handlers[JOBS.SYNC]));
      await queue.work(JOBS.BACKFILL, {}, wrap(JOBS.BACKFILL, handlers[JOBS.BACKFILL]));
      // Pocas descargas a la vez por proveedor, en total entre todos los workers (groupConcurrency)
      await queue.work(
        JOBS.FETCH,
        { localConcurrency: 4, groupConcurrency: 2 },
        wrap(JOBS.FETCH, handlers[JOBS.FETCH]),
      );
      await queue.work(
        JOBS.NORMALIZE,
        { localConcurrency: 4 },
        wrap(JOBS.NORMALIZE, handlers[JOBS.NORMALIZE]),
      );
      await queue.work(
        JOBS.SCHEDULED_SYNC,
        {},
        wrap(JOBS.SCHEDULED_SYNC, handlers[JOBS.SCHEDULED_SYNC]),
      );
      await queue.work(JOBS.MAINTENANCE, {}, wrap(JOBS.MAINTENANCE, handlers[JOBS.MAINTENANCE]));
      await queue.work(
        JOBS.CLINICAL_EXTRACT,
        { localConcurrency: 2 },
        wrap(JOBS.CLINICAL_EXTRACT, handlers[JOBS.CLINICAL_EXTRACT]),
      );

      const tz = config.TIMEZONE;
      await queue.schedule(
        JOBS.SCHEDULED_SYNC,
        config.XIAOMI_SYNC_CRON,
        { provider: XIAOMI },
        { tz, key: XIAOMI },
      );
      await queue.schedule(
        JOBS.SCHEDULED_SYNC,
        config.INTERVALS_SYNC_CRON,
        { provider: INTERVALS },
        { tz, key: INTERVALS },
      );
      if (providers.google) {
        await queue.schedule(
          JOBS.SCHEDULED_SYNC,
          config.GOOGLE_SYNC_CRON,
          { provider: GOOGLE },
          { tz, key: GOOGLE },
        );
      }
      await queue.schedule(JOBS.MAINTENANCE, '30 3 * * *', {}, { tz });
    },
  };
}
