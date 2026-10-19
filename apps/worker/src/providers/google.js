import {
  GoogleHealthClient,
  GoogleHealthErrorCode,
  dataTypesForScopes,
  getDataType,
  getPointTime,
  listDataPoints,
} from '@digitaltwin/google-health';
import { JOBS, PRIORITY } from '@digitaltwin/queue';
import { DAY_MS, splitDays, utcDay } from '@digitaltwin/timeline';
import { RateLimitedError } from '../rate-limit.js';

export const GOOGLE = 'google-health';

/**
 * Google Health: mucho volumen (FC cada pocos segundos), así que todo va por trozos.
 * Cada trozo (tipo + rango de días) es un trabajo `fetch`; lo descargado se guarda como un
 * raw_record por tipo y día UTC, que es la verdad de ese día (si algo desaparece, se borra).
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/connections').createDbConnectionStore>} deps.connections
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createPipeline>} deps.pipeline
 * @param {ReturnType<typeof import('@digitaltwin/queue').createQueue>} deps.queue
 * @param {ReturnType<typeof import('../rate-limit.js').createRateLimiter>} deps.limiter
 * @param {{ clientId: string, clientSecret: string }} deps.oauth
 * @param {string} deps.timeZone
 * @param {typeof listDataPoints} [deps.listPoints]  Para tests.
 * @param {(connection: object, onRefresh: Function) => object} [deps.createClient]  Para tests.
 * @param {import('pino').Logger} [deps.logger]
 */
export function createGoogleProvider({
  connections,
  pipeline,
  queue,
  limiter,
  oauth,
  timeZone,
  listPoints = listDataPoints,
  createClient = (connection, onCredentialsRefreshed) =>
    new GoogleHealthClient({
      credentials: connection.credentials,
      ...oauth,
      onCredentialsRefreshed,
    }),
  logger,
}) {
  /** Los tipos que se pueden leer con lo que el usuario concedió. */
  const dataTypesOf = (connection) =>
    dataTypesForScopes(connection.credentials?.scope ?? '').map((t) => t.id);

  async function expire(userId, connection, message) {
    const latest = (await connections.get(userId, GOOGLE)) ?? connection;
    await connections.save({ ...latest, status: 'expired', error: message });
    await pipeline.store.cancelBackfills(userId, GOOGLE);
    logger?.warn({ userId }, 'Google: hay que volver a conectar');
  }

  return {
    /**
     * Encola la descarga de [from, to) en trozos de `chunkDays` días por cada tipo, del más
     * reciente al más antiguo. Devuelve cuántos trabajos ha encolado.
     */
    async plan(userId, { from, to, chunkDays = 1, priority = PRIORITY.LIVE, backfillId, types }) {
      const connection = await connections.get(userId, GOOGLE);
      if (connection?.status !== 'connected') return 0;
      const kinds = types ?? dataTypesOf(connection);
      const days = splitDays(from, to, { newestFirst: true });
      const jobs = [];
      for (let i = 0; i < days.length; i += chunkDays) {
        const chunk = days.slice(i, i + chunkDays);
        const range = { from: chunk.at(-1).from.toISOString(), to: chunk[0].to.toISOString() };
        for (const kind of kinds) {
          jobs.push({
            data: { userId, provider: GOOGLE, kind, ...range, backfillId, priority },
            priority,
            group: { id: GOOGLE },
          });
        }
      }
      if (jobs.length) await queue.insert(JOBS.FETCH, jobs);
      return jobs.length;
    },

    /** Descarga un trozo y guarda un raw_record por día. */
    async fetch({ userId, kind, from, to }, { priority } = {}) {
      const connection = await connections.get(userId, GOOGLE);
      if (connection?.status !== 'connected') return { skipped: 'not-connected' };
      await limiter.take(GOOGLE);

      const client = createClient(connection, async (credentials) => {
        const latest = (await connections.get(userId, GOOGLE)) ?? connection;
        await connections.save({ ...latest, credentials });
      });
      let points;
      try {
        points = await listPoints(client, kind, { from, to, timeZone });
      } catch (err) {
        if (err.code === GoogleHealthErrorCode.REAUTH_REQUIRED) {
          await expire(userId, connection, 'Google ha retirado el permiso: vuelve a conectar');
          return { skipped: 'expired' };
        }
        if (err.code === GoogleHealthErrorCode.RATE_LIMITED) throw new RateLimitedError(GOOGLE, 60);
        // Tipo no permitido o no disponible para esta cuenta: reintentar no lo arregla
        if (
          err.code === GoogleHealthErrorCode.PERMISSION_DENIED ||
          err.code === GoogleHealthErrorCode.INVALID_REQUEST ||
          err.code === GoogleHealthErrorCode.NOT_FOUND
        ) {
          logger?.info({ userId, kind, err: err.message }, 'Google: tipo no disponible');
          return { skipped: 'unavailable' };
        }
        throw err;
      }

      const byDay = groupByDay(kind, points);
      // Los días sin datos también se guardan: así lo que se borró en Google se borra aquí
      for (const day of splitDays(from, to)) {
        const key = day.from.toISOString().slice(0, 10);
        if (!byDay.has(key)) byDay.set(key, []);
      }

      let changed = 0;
      for (const [key, dayPoints] of byDay) {
        const start = new Date(`${key}T00:00:00.000Z`);
        const end = new Date(start.getTime() + DAY_MS);
        const result = await pipeline.ingest(
          {
            userId,
            provider: GOOGLE,
            kind,
            externalId: `${kind}:${key}`,
            periodStart: start,
            periodEnd: end,
            payload: {
              dataType: kind,
              from: start.toISOString(),
              to: end.toISOString(),
              points: dayPoints,
            },
          },
          { priority },
        );
        if (result.changed) changed++;
      }
      return { points: points.length, days: byDay.size, changed };
    },
  };
}

/** Día UTC al que pertenece cada punto: su fecha (diarios), su fin (sueño) o su inicio. */
export function groupByDay(kind, points) {
  const type = getDataType(kind);
  const byDay = new Map();
  for (const point of points) {
    const time = getPointTime(kind, point);
    const instant = type.kind === 'sleep' ? (time.end ?? time.start) : time.start;
    const key = time.date ?? (instant ? utcDay(instant).toISOString().slice(0, 10) : null);
    if (!key) continue;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(point);
  }
  return byDay;
}
