import { JOBS, PRIORITY } from '@digitaltwin/queue';
import { createCatalog } from './catalog.js';
import { createTimelineStore } from './store.js';
import { createTimelineQueries } from './queries.js';
import { normalizerFor } from './normalizers/index.js';

/**
 * El pipeline completo sobre una BD: catálogo, almacén, consultas y los dos pasos comunes a
 * todas las fuentes (ingest y normalize). Lo usan la API (ingest de lo que llega por webhook) y
 * el worker (todo lo demás).
 * @param {object} deps
 * @param {import('postgres').Sql} deps.db
 * @param {ReturnType<typeof import('@digitaltwin/queue').createQueue>} deps.queue
 * @param {string} [deps.timeZone]  Para los datos diarios de Google (fecha local → instante).
 * @param {import('pino').Logger} [deps.logger]
 */
export function createPipeline({ db, queue, timeZone = 'Europe/Madrid', logger }) {
  const catalog = createCatalog(db);
  const store = createTimelineStore({ db, catalog });
  const queries = createTimelineQueries({ db, catalog });

  return {
    catalog,
    store,
    queries,

    /**
     * Guarda un registro crudo y, si es nuevo o ha cambiado, encola su normalización.
     * @param {Parameters<typeof store.saveRaw>[0]} record
     * @param {{ priority?: number }} [options]
     */
    async ingest(record, { priority = PRIORITY.LIVE } = {}) {
      const result = await store.saveRaw(record);
      // Un día nuevo y vacío (casi todo un backfill) no tiene nada que crear ni que borrar
      const empty = Array.isArray(record.payload?.points) && record.payload.points.length === 0;
      if (result.changed && !(result.inserted && empty)) {
        await queue.send(JOBS.NORMALIZE, { rawId: result.id }, { priority });
      }
      return result;
    },

    /** raw_record → observations/episodes. Los tipos sin normalizador se quedan en crudo. */
    async normalize(rawId) {
      const raw = await store.getRaw(rawId);
      if (!raw) return { skipped: 'missing' };
      const normalizer = normalizerFor(raw.provider, raw.kind);
      if (!normalizer) return { skipped: 'no-normalizer' };
      const result = raw.deleted_at
        ? emptyFor(raw, normalizer, timeZone)
        : normalizer(raw.payload, { timeZone });
      const written = await store.applyNormalized(raw, result);
      logger?.debug({ rawId, provider: raw.provider, kind: raw.kind, ...written }, 'normalizado');
      return written;
    },
  };
}

/** Lo que generaría el normalizador sin datos (para dejar vacío lo que se borró en origen). */
function emptyFor(raw, normalizer, timeZone) {
  try {
    return {
      ...normalizer({ ...raw.payload, points: [] }, { timeZone }),
      observations: [],
      episodes: [],
    };
  } catch {
    return { mode: 'exact', observations: [], episodes: [] };
  }
}
