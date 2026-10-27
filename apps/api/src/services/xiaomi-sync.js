import {
  XiaomiCloudClient,
  XiaomiError,
  getScaleMeasurements,
  DEFAULT_SCALE_MODEL,
} from '@digitaltwin/xiaomi';
import { HttpError } from '../utils/http-error.js';
import { publicConnection } from '@digitaltwin/connections';

const OVERLAP_MS = 24 * 3600 * 1000;

/**
 * Trae las mediciones de la báscula de Xiaomi: la primera vez todo el histórico y después desde la
 * última sincronización (con un día de solape por si alguna llegó tarde a la nube).
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/connections').createMemoryConnectionStore>} deps.store
 * @param {ReturnType<typeof import('./measurements.js').createMemoryMeasurementStore>} deps.measurements
 * @param {(connection: object, options: { from?: Date, onCredentialsRefreshed: Function }) => Promise<object[]>} [deps.fetchMeasurements]
 *   Descarga de Xiaomi (se sustituye en tests).
 * @param {() => number} [deps.now]
 * @param {import('pino').Logger} [deps.logger]
 */
export function createXiaomiSync({
  store,
  measurements,
  fetchMeasurements = fetchFromXiaomi,
  now = Date.now,
  logger,
}) {
  // Una sincronización a la vez por usuario: si pulsas dos veces, la segunda espera a la primera
  const running = new Map();

  async function run(userId) {
    const connection = await store.get(userId, 'xiaomi');
    if (!connection || connection.status === 'disconnected') {
      throw HttpError.conflict('La báscula no está conectada', { code: 'NOT_CONNECTED' });
    }

    const from = connection.lastSync
      ? new Date(Date.parse(connection.lastSync) - OVERLAP_MS)
      : undefined;
    let raw;
    try {
      raw = await fetchMeasurements(connection, {
        from,
        // Si Xiaomi renueva el token por el camino, nos quedamos con el nuevo
        onCredentialsRefreshed: (credentials) => store.save({ ...connection, credentials }),
      });
    } catch (err) {
      if (err instanceof XiaomiError && err.code === 'SESSION_EXPIRED') {
        await store.save({
          ...connection,
          status: 'expired',
          error: 'La báscula ha cerrado la sesión: vuelve a conectar',
        });
        throw HttpError.conflict('La báscula ha cerrado la sesión: vuelve a conectar', {
          code: 'RECONNECT_REQUIRED',
        });
      }
      logger?.warn({ err }, 'Fallo sincronizando Xiaomi');
      throw new HttpError(502, `La báscula no ha devuelto los datos: ${err.message}`, {
        code: 'XIAOMI_ERROR',
      });
    }

    const items = raw
      .filter((m) => m.timestamp)
      .map(({ raw: original, ...measurement }) => ({
        source: 'xiaomi',
        externalId: measurement.id,
        type: 'body-composition',
        timestamp: new Date(measurement.timestamp).toISOString(),
        values: measurement,
        raw: original,
      }));
    const added = await measurements.upsert(userId, items);
    const all = await measurements.list(userId, { source: 'xiaomi' });
    const last = all.at(-1);

    // Puede haber cambiado (token renovado) mientras descargaba
    const current = (await store.get(userId, 'xiaomi')) ?? connection;
    const saved = await store.save({
      ...current,
      status: 'connected',
      error: undefined,
      lastSync: new Date(now()).toISOString(),
      records: all.length,
      firstRecordAt: all[0]?.timestamp,
      lastRecord: last && {
        at: last.timestamp,
        weight: last.values.weight,
        bodyFat: last.values.bodyFat,
      },
    });
    logger?.info(
      { userId, fetched: items.length, added, total: all.length },
      'Xiaomi sincronizado',
    );
    return { fetched: items.length, added, total: all.length, connection: publicConnection(saved) };
  }

  return {
    sync(userId) {
      if (!running.has(userId)) {
        running.set(
          userId,
          run(userId).finally(() => running.delete(userId)),
        );
      }
      return running.get(userId);
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
