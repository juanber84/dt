import {
  XiaomiCloudClient,
  XiaomiError,
  XiaomiErrorCode,
  getScaleMeasurements,
  DEFAULT_SCALE_MODEL,
} from '@digitaltwin/xiaomi';

export const XIAOMI = 'xiaomi';
// 14 días de solape: la báscula guarda los pesajes offline y los sube cuando conecta con el móvil
const OVERLAP_MS = 14 * 24 * 3600 * 1000;

/**
 * Báscula de Xiaomi: pocas mediciones al día, así que el histórico entero cabe en un trabajo.
 * Cada medición es un raw_record (el registro tal cual de Xiaomi).
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/connections').createDbConnectionStore>} deps.connections
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createPipeline>} deps.pipeline
 * @param {ReturnType<typeof import('../rate-limit.js').createRateLimiter>} deps.limiter
 * @param {(connection: object, options: object) => Promise<object[]>} [deps.fetchMeasurements]
 * @param {() => number} [deps.now]
 * @param {import('pino').Logger} [deps.logger]
 */
export function createXiaomiProvider({
  connections,
  pipeline,
  limiter,
  fetchMeasurements = fetchFromXiaomi,
  now = Date.now,
  logger,
}) {
  return {
    /**
     * Trae lo nuevo desde la última vez (o todo, con `full`).
     * @returns {Promise<{ fetched: number, changed: number } | { skipped: string }>}
     */
    async sync(userId, { full = false, priority } = {}) {
      const connection = await connections.get(userId, XIAOMI);
      if (connection?.status !== 'connected') return { skipped: 'not-connected' };
      await limiter.take(XIAOMI);

      const from =
        !full && connection.lastSync
          ? new Date(Date.parse(connection.lastSync) - OVERLAP_MS)
          : undefined;
      let measurements;
      try {
        measurements = await fetchMeasurements(connection, {
          from,
          onCredentialsRefreshed: async (credentials) => {
            const latest = (await connections.get(userId, XIAOMI)) ?? connection;
            await connections.save({ ...latest, credentials });
          },
        });
      } catch (err) {
        if (err instanceof XiaomiError && err.code === XiaomiErrorCode.SESSION_EXPIRED) {
          const latest = (await connections.get(userId, XIAOMI)) ?? connection;
          await connections.save({
            ...latest,
            status: 'expired',
            error: 'Xiaomi ha cerrado la sesión: vuelve a conectar',
          });
          logger?.warn({ userId }, 'Xiaomi: sesión caducada, hay que reconectar');
          return { skipped: 'expired' };
        }
        throw err;
      }

      let changed = 0;
      const valid = measurements.filter((m) => m.timestamp);
      for (const m of valid) {
        const result = await pipeline.ingest(
          {
            userId,
            provider: XIAOMI,
            kind: 'scale',
            externalId: m.id,
            periodStart: m.timestamp,
            periodEnd: m.timestamp + 1,
            payload: m.raw,
          },
          { priority },
        );
        if (result.changed) changed++;
      }

      const last = valid.at(-1);
      const latest = (await connections.get(userId, XIAOMI)) ?? connection;
      const newer =
        last && (!latest.lastRecord || Date.parse(latest.lastRecord.at) <= last.timestamp);
      await connections.save({
        ...latest,
        status: 'connected',
        error: undefined,
        lastSync: new Date(now()).toISOString(),
        records: await pipeline.store.countRaw(userId, XIAOMI, 'scale'),
        ...(newer && {
          lastRecord: {
            at: new Date(last.timestamp).toISOString(),
            weight: last.weight,
            bodyFat: last.bodyFat,
          },
        }),
      });
      logger?.info({ userId, fetched: valid.length, changed }, 'Xiaomi sincronizado');
      return { fetched: valid.length, changed };
    },
  };
}

async function fetchFromXiaomi(connection, { from, onCredentialsRefreshed }) {
  const client = new XiaomiCloudClient({
    credentials: connection.credentials,
    region: connection.region,
    onCredentialsRefreshed,
  });
  // Una pasada por cada modelo de báscula de la cuenta (normalmente solo una)
  const models = [...new Set((connection.details?.devices ?? []).map((d) => d.model))];
  const all = [];
  for (const model of models.length ? models : [DEFAULT_SCALE_MODEL]) {
    all.push(...(await getScaleMeasurements(client, { from, model })));
  }
  return all;
}
