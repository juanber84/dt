import {
  createIntervalsClient,
  IntervalsError,
  IntervalsErrorCode,
} from '@digitaltwin/intervals-icu';
import { localMidnight } from '@digitaltwin/timeline';
import { RateLimitedError } from '../rate-limit.js';

export const INTERVALS = 'intervals-icu';
const DAY_MS = 24 * 3600 * 1000;
// Una semana de solape: intervals recalcula TSS y CTL/ATL de días pasados (y Garmin sube tarde)
const OVERLAP_MS = 7 * DAY_MS;
// La API devuelve de golpe todo el rango: trozos de medio año en la carga inicial
const CHUNK_DAYS = 180;

/**
 * intervals.icu con la clave personal: actividades (un raw_record cada una, por su id) y el
 * wellness de cada día (uno por fecha). Lo que deje de devolver no se borra: las actividades van
 * en modo exact y nada las marca como borradas (si corta lo de Garmin, lo ya traído se queda).
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/connections').createDbConnectionStore>} deps.connections
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createPipeline>} deps.pipeline
 * @param {ReturnType<typeof import('../rate-limit.js').createRateLimiter>} deps.limiter
 * @param {string} deps.timeZone
 * @param {number} [deps.backfillDays]
 * @param {(apiKey: string) => ReturnType<typeof createIntervalsClient>} [deps.createClient]
 * @param {() => number} [deps.now]
 * @param {import('pino').Logger} [deps.logger]
 */
export function createIntervalsProvider({
  connections,
  pipeline,
  limiter,
  timeZone,
  backfillDays = 730,
  createClient = (apiKey) => createIntervalsClient({ apiKey }),
  now = Date.now,
  logger,
}) {
  const localDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(ms)); // YYYY-MM-DD

  async function call(fn) {
    await limiter.take(INTERVALS);
    try {
      return await fn();
    } catch (err) {
      if (err instanceof IntervalsError && err.code === IntervalsErrorCode.RATE_LIMITED) {
        throw new RateLimitedError(INTERVALS, err.retryAfterSeconds);
      }
      throw err;
    }
  }

  return {
    /**
     * Trae lo nuevo desde la última vez (con una semana de solape) o, con `full`, los últimos
     * `backfillDays` días.
     * @returns {Promise<{ activities: number, wellness: number, changed: number } | { skipped: string }>}
     */
    async sync(userId, { full = false, priority } = {}) {
      const connection = await connections.get(userId, INTERVALS);
      if (connection?.status !== 'connected') return { skipped: 'not-connected' };
      const client = createClient(connection.credentials.apiKey);

      const to = now();
      const from =
        !full && connection.lastSync
          ? Date.parse(connection.lastSync) - OVERLAP_MS
          : to - backfillDays * DAY_MS;

      let activities = 0;
      let wellness = 0;
      let changed = 0;
      try {
        for (let start = from; start < to; start += CHUNK_DAYS * DAY_MS) {
          const range = {
            oldest: localDate(start),
            newest: localDate(Math.min(to, start + (CHUNK_DAYS - 1) * DAY_MS)),
          };
          for (const activity of await call(() => client.activities(range))) {
            const begin = Date.parse(activity.start_date);
            const seconds = Number(activity.elapsed_time ?? activity.moving_time) || 0;
            const result = await pipeline.ingest(
              {
                userId,
                provider: INTERVALS,
                kind: 'activity',
                externalId: activity.id,
                periodStart: begin,
                periodEnd: begin + Math.max(1, seconds) * 1000,
                payload: activity,
              },
              { priority },
            );
            activities++;
            if (result.changed) changed++;
          }
          for (const day of await call(() => client.wellness(range))) {
            if (!day?.id) continue;
            const next = new Date(Date.parse(`${day.id}T00:00:00Z`) + DAY_MS)
              .toISOString()
              .slice(0, 10);
            const result = await pipeline.ingest(
              {
                userId,
                provider: INTERVALS,
                kind: 'wellness',
                externalId: day.id,
                periodStart: localMidnight(day.id, timeZone),
                periodEnd: localMidnight(next, timeZone),
                payload: day,
              },
              { priority },
            );
            wellness++;
            if (result.changed) changed++;
          }
        }
      } catch (err) {
        if (err instanceof IntervalsError && err.code === IntervalsErrorCode.INVALID_KEY) {
          const latest = (await connections.get(userId, INTERVALS)) ?? connection;
          await connections.save({
            ...latest,
            status: 'expired',
            error: 'intervals.icu no acepta la clave: vuelve a conectar',
          });
          logger?.warn({ userId }, 'intervals.icu: clave rechazada');
          return { skipped: 'expired' };
        }
        throw err;
      }

      const latest = (await connections.get(userId, INTERVALS)) ?? connection;
      await connections.save({
        ...latest,
        status: 'connected',
        error: undefined,
        lastSync: new Date(to).toISOString(),
        records: await pipeline.store.countRaw(userId, INTERVALS, 'activity'),
      });
      logger?.info({ userId, activities, wellness, changed }, 'intervals.icu sincronizado');
      return { activities, wellness, changed };
    },
  };
}
