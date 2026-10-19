/**
 * Mediciones crudas de cada usuario tal cual llegan de cada fuente (source + externalId, sin
 * fusionar: el valor canónico se decide después). En memoria: solo sin BD (con BD van al timeline,
 * ver createTimelineMeasurements).
 */
export function createMemoryMeasurementStore() {
  const byUser = new Map();
  const bucket = (userId) => byUser.get(userId) ?? byUser.set(userId, new Map()).get(userId);

  return {
    /**
     * Inserta o actualiza por (source, externalId). Devuelve cuántas eran nuevas.
     * @param {string} userId
     * @param {Array<{ source: string, externalId: string, timestamp: string }>} items
     */
    async upsert(userId, items) {
      const map = bucket(userId);
      let added = 0;
      for (const item of items) {
        const key = `${item.source}:${item.externalId}`;
        if (!map.has(key)) added++;
        map.set(key, item);
      }
      return added;
    },

    /** Ordenadas por fecha. `from`/`to` en ISO, incluidos. */
    async list(userId, { source, from, to } = {}) {
      return [...bucket(userId).values()]
        .filter(
          (m) =>
            (!source || m.source === source) &&
            (!from || m.timestamp >= from) &&
            (!to || m.timestamp <= to),
        )
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    },
  };
}

/**
 * GET /measurements con BD: los pesajes del timeline (episodios weigh-in) con la misma forma que
 * el store en memoria.
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createTimelineQueries>} queries
 */
export function createTimelineMeasurements(queries) {
  return {
    async list(userId, { source, from, to } = {}) {
      const episodes = await queries.episodes({
        userId,
        from: new Date(from ?? 0),
        to: to ? new Date(Date.parse(to) + 1) : new Date(Date.now() + 24 * 3600 * 1000),
        kinds: ['weigh-in'],
      });
      return episodes
        .filter((e) => !source || e.provider === source)
        .map((e) => ({
          source: e.provider,
          type: 'body-composition',
          timestamp: e.start,
          values: e.details,
        }));
    },
  };
}
