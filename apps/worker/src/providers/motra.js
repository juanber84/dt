import { createMotraClient, MotraError, MotraErrorCode, flattenCalendar } from '@digitaltwin/motra';
import { RateLimitedError } from '../rate-limit.js';

export const MOTRA = 'motra';
const DAY_MS = 24 * 3600 * 1000;
// Una semana de solape: un entreno se puede corregir días después (series, pesos, nombre)
const OVERLAP_MS = 7 * DAY_MS;
// El índice se pide por tramos de medio año (en la carga inicial)
const CHUNK_DAYS = 180;

/**
 * Motra con el refresh token de Firebase: por cada entreno un raw_record (por su workoutID) con
 * el detalle completo (series, reps, peso). Lo que Motra deje de devolver no se borra.
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/connections').createDbConnectionStore>} deps.connections
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createPipeline>} deps.pipeline
 * @param {ReturnType<typeof import('../rate-limit.js').createRateLimiter>} deps.limiter
 * @param {number} [deps.backfillDays]
 * @param {string} [deps.firebaseApiKey]
 * @param {(options: { refreshToken: string, onRefreshToken: Function }) => ReturnType<typeof createMotraClient>} [deps.createClient]
 * @param {() => number} [deps.now]
 * @param {import('pino').Logger} [deps.logger]
 */
export function createMotraProvider({
  connections,
  pipeline,
  limiter,
  backfillDays = 1825,
  firebaseApiKey,
  createClient = (options) =>
    createMotraClient({ ...options, ...(firebaseApiKey && { apiKey: firebaseApiKey }) }),
  now = Date.now,
  logger,
}) {
  async function call(fn) {
    await limiter.take(MOTRA);
    try {
      return await fn();
    } catch (err) {
      if (err instanceof MotraError && err.code === MotraErrorCode.RATE_LIMITED) {
        throw new RateLimitedError(MOTRA, err.retryAfterSeconds);
      }
      throw err;
    }
  }

  return {
    /**
     * Trae lo nuevo desde la última vez (con una semana de solape) o, con `full`, los últimos
     * `backfillDays` días.
     * @returns {Promise<{ workouts: number, changed: number } | { skipped: string }>}
     */
    async sync(userId, { full = false, priority } = {}) {
      const connection = await connections.get(userId, MOTRA);
      if (connection?.status !== 'connected') return { skipped: 'not-connected' };
      const client = createClient({
        refreshToken: connection.credentials.refreshToken,
        // Firebase puede rotar el refresh token: si no se guarda, la próxima vez no valdría
        onRefreshToken: async (refreshToken) => {
          const latest = (await connections.get(userId, MOTRA)) ?? connection;
          await connections.save({
            ...latest,
            credentials: { ...latest.credentials, refreshToken },
          });
        },
      });

      const to = now();
      const from =
        !full && connection.lastSync
          ? Date.parse(connection.lastSync) - OVERLAP_MS
          : to - backfillDays * DAY_MS;

      let workouts = 0;
      let changed = 0;
      try {
        for (let start = from; start < to; start += CHUNK_DAYS * DAY_MS) {
          const endMs = Math.min(to, start + CHUNK_DAYS * DAY_MS);
          const calendar = await call(() => client.calendarWorkouts({ startMs: start, endMs }));
          for (const entry of flattenCalendar(calendar)) {
            const details = await call(() => client.workoutDetails(entry.workoutID));
            if (!details) continue;
            // El tipo (fuerza, cardio...) solo viene en el índice, no en el detalle
            const workout = {
              ...details,
              activityType: details.activityType ?? entry.activityType ?? null,
              workoutFormat: details.workoutFormat ?? entry.workoutFormat ?? null,
            };
            const begin = Math.round((workout.timeStarted ?? entry.timeStarted) * 1000);
            const finish = Math.round((workout.timeEnded ?? entry.timeEnded ?? 0) * 1000);
            const result = await pipeline.ingest(
              {
                userId,
                provider: MOTRA,
                kind: 'workout',
                externalId: workout.workoutID ?? entry.workoutID,
                periodStart: begin,
                periodEnd: Math.max(begin + 1000, finish),
                payload: workout,
              },
              { priority },
            );
            workouts++;
            if (result.changed) changed++;
          }
        }
      } catch (err) {
        if (err instanceof MotraError && err.code === MotraErrorCode.SESSION_EXPIRED) {
          const latest = (await connections.get(userId, MOTRA)) ?? connection;
          await connections.save({
            ...latest,
            status: 'expired',
            error: 'La sesión de Motra ha caducado (¿cambiaste la contraseña?): vuelve a conectar',
          });
          logger?.warn({ userId }, 'Motra: sesión caducada');
          return { skipped: 'expired' };
        }
        throw err;
      }

      const latest = (await connections.get(userId, MOTRA)) ?? connection;
      await connections.save({
        ...latest,
        status: 'connected',
        error: undefined,
        lastSync: new Date(to).toISOString(),
        records: await pipeline.store.countRaw(userId, MOTRA, 'workout'),
      });
      logger?.info({ userId, workouts, changed }, 'Motra sincronizado');
      return { workouts, changed };
    },
  };
}
