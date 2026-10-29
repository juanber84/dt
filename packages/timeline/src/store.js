import { createHash } from 'node:crypto';

const INSERT_CHUNK = 5000;

/**
 * Acceso a las tablas del pipeline (migraciones 0003 y 0004 de @digitaltwin/db).
 * @param {object} deps
 * @param {import('postgres').Sql} deps.db
 * @param {ReturnType<typeof import('./catalog.js').createCatalog>} deps.catalog
 */
export function createTimelineStore({ db, catalog }) {
  const streamIds = new Map();

  /**
   * Fuera de la transacción a propósito: con varias normalizaciones a la vez, un stream creado
   * dentro de una transacción sin confirmar (y ya en la caché) rompía la clave foránea de otra.
   */
  async function streamId(sql, userId, provider, origin, details = {}) {
    const key = `${userId}|${provider}|${origin}`;
    if (streamIds.has(key)) return streamIds.get(key);
    const [row] = await sql`
      insert into streams (user_id, provider, origin, details)
      values (${userId}, ${provider}, ${origin}, ${sql.json(clean(details))})
      on conflict (user_id, provider, origin) do update set details = excluded.details
      returning id
    `;
    streamIds.set(key, row.id);
    return row.id;
  }

  /** Escritura de applyNormalized (dentro de su transacción). */
  async function write(tx, raw, { mode, range, observations, episodes, metrics, metricIds }) {
    const userId = raw.user_id;
    const provider = raw.provider;
    // Filas sin duplicados (la última gana): ON CONFLICT no admite la misma fila dos veces
    const rows = new Map();
    let min = Infinity;
    let max = -Infinity;
    for (const o of observations) {
      const time = new Date(o.time);
      const sid = await streamId(db, userId, provider, o.origin, o.originDetails);
      const mid = metricIds.get(o.metric);
      rows.set(`${mid}|${time.getTime()}|${sid}`, [
        time,
        mid,
        sid,
        o.value,
        o.end ? new Date(o.end) : null,
      ]);
      min = Math.min(min, time.getTime());
      max = Math.max(max, time.getTime());
    }

    if (mode === 'range') {
      const owned = [...new Set(metrics.map((code) => metricIds.get(code)))];
      // `range` del normalizador manda sobre el periodo del raw (p. ej. los diarios de Google)
      const start = range ? new Date(range.from) : raw.period_start;
      const end = range ? new Date(range.to) : raw.period_end;
      const from = new Date(Math.min(start.getTime(), min));
      const to = new Date(Math.max(end.getTime(), max + 1));
      if (owned.length) {
        await tx`
            delete from observations
            where user_id = ${userId}
              and metric_id = any(${owned}::smallint[])
              and time >= ${from} and time < ${to}
              and stream_id in (
                select id from streams where user_id = ${userId} and provider = ${provider}
              )
          `;
      }
    } else if (raw.produced?.length) {
      const keep = new Set(rows.keys());
      const gone = raw.produced.filter(
        ([mid, time, sid]) => !keep.has(`${mid}|${new Date(time).getTime()}|${sid}`),
      );
      if (gone.length) {
        await tx`
            delete from observations o
            using unnest(
              ${gone.map((k) => k[0])}::smallint[],
              ${gone.map((k) => new Date(k[1]).toISOString())}::timestamptz[],
              ${gone.map((k) => k[2])}::int[]
            ) as k(m, t, s)
            where o.user_id = ${userId} and o.metric_id = k.m and o.time = k.t and o.stream_id = k.s
          `;
      }
    }

    const list = [...rows.values()];
    for (let i = 0; i < list.length; i += INSERT_CHUNK) {
      const chunk = list.slice(i, i + INSERT_CHUNK);
      await tx`
          insert into observations (time, user_id, metric_id, stream_id, value, end_time)
          select t, ${userId}::uuid, m, s, v, e
          from unnest(
            ${chunk.map((r) => r[0].toISOString())}::timestamptz[],
            ${chunk.map((r) => r[1])}::smallint[],
            ${chunk.map((r) => r[2])}::int[],
            ${chunk.map((r) => r[3])}::float8[],
            ${chunk.map((r) => r[4]?.toISOString() ?? null)}::timestamptz[]
          ) as x(t, m, s, v, e)
          on conflict (user_id, metric_id, time, stream_id) do update set
            value = excluded.value, end_time = excluded.end_time
        `;
    }

    const kept = [];
    for (const e of episodes) {
      const sid = await streamId(db, userId, provider, e.origin, e.originDetails);
      const [row] = await tx`
          insert into episodes (
            user_id, stream_id, raw_id, kind, external_id, start_time, end_time, title,
            summary, schema, details
          ) values (
            ${userId}, ${sid}, ${raw.id}, ${e.kind}, ${String(e.externalId)}, ${new Date(e.start)},
            ${e.end ? new Date(e.end) : null}, ${e.title ?? null}, ${tx.json(clean(e.summary ?? {}))},
            ${e.schema}, ${tx.json(clean(e.details ?? {}))}
          )
          on conflict (user_id, stream_id, kind, external_id) do update set
            raw_id = excluded.raw_id, start_time = excluded.start_time,
            end_time = excluded.end_time, title = excluded.title, summary = excluded.summary,
            schema = excluded.schema, details = excluded.details, deleted_at = null,
            updated_at = now()
          returning id
        `;
      kept.push(row.id);
    }
    await tx`
        delete from episodes where raw_id = ${raw.id} and not (id = any(${kept}::uuid[]))
      `;

    const produced =
      mode === 'exact' ? list.map(([time, mid, sid]) => [mid, time.toISOString(), sid]) : null;
    await tx`
        update raw_records set normalized_at = now(), produced = ${produced ? tx.json(produced) : null}
        where id = ${raw.id}
      `;
    return { observations: list.length, episodes: kept.length };
  }

  return {
    /**
     * Guarda (o actualiza) un registro crudo. Si ya estaba igual no cambia nada.
     * @returns {Promise<{ id: number, changed: boolean, inserted: boolean }>}
     */
    async saveRaw({ userId, provider, kind, externalId, periodStart, periodEnd, payload }) {
      const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const [row] = await db`
        insert into raw_records (
          user_id, provider, kind, external_id, period_start, period_end, payload, payload_hash
        ) values (
          ${userId}, ${provider}, ${kind}, ${String(externalId)}, ${new Date(periodStart)},
          ${new Date(periodEnd)}, ${db.json(payload)}, ${hash}
        )
        on conflict (user_id, provider, kind, external_id) do update set
          payload = excluded.payload,
          payload_hash = excluded.payload_hash,
          period_start = excluded.period_start,
          period_end = excluded.period_end,
          version = raw_records.version + 1,
          updated_at = now(),
          normalized_at = null,
          deleted_at = null
        where raw_records.payload_hash <> excluded.payload_hash
          or raw_records.deleted_at is not null
        returning id, (xmax = 0) as inserted
      `;
      if (row) return { id: Number(row.id), changed: true, inserted: row.inserted };
      const [existing] = await db`
        select id from raw_records
        where user_id = ${userId} and provider = ${provider} and kind = ${kind}
          and external_id = ${String(externalId)}
      `;
      return { id: Number(existing.id), changed: false, inserted: false };
    },

    /** Borrado en origen: se marca (no se borra) y la normalización lo deja sin datos. */
    async markRawDeleted({ userId, provider, kind, externalId }) {
      const [row] = await db`
        update raw_records set deleted_at = now(), normalized_at = null, updated_at = now()
        where user_id = ${userId} and provider = ${provider} and kind = ${kind}
          and external_id = ${String(externalId)} and deleted_at is null
        returning id
      `;
      return row ? Number(row.id) : null;
    },

    /** El registro crudo vivo (sin borrar) de un origen, o null. */
    async findRaw({ userId, provider, kind, externalId }) {
      const [row] = await db`
        select * from raw_records
        where user_id = ${userId} and provider = ${provider} and kind = ${kind}
          and external_id = ${String(externalId)} and deleted_at is null
      `;
      return row ?? null;
    },

    async countRaw(userId, provider, kind) {
      const [row] = await db`
        select count(*)::int as n from raw_records
        where user_id = ${userId} and provider = ${provider} and kind = ${kind} and deleted_at is null
      `;
      return row.n;
    },

    async getRaw(id) {
      const [row] = await db`select * from raw_records where id = ${id}`;
      return row ?? null;
    },

    /**
     * Escribe lo que devuelve un normalizador para `raw` en una transacción: streams, métricas,
     * observaciones (por lotes) y episodios, reemplazando lo que generó antes.
     */
    async applyNormalized(raw, result) {
      const { mode, range, observations, episodes, metrics = [], newMetrics = {} } = result;

      // Métricas fuera de la transacción: el catálogo es compartido y no se deshace
      const metricIds = new Map();
      for (const code of new Set([...metrics, ...observations.map((o) => o.metric)])) {
        metricIds.set(code, await catalog.id(code, newMetrics[code]));
      }

      return db.begin(async (tx) =>
        write(tx, raw, { mode, range, observations, episodes, metrics, metricIds }),
      );
    },

    // Buzón de entrada

    async recordInbox({ provider, kind, type, userId = null, payload }) {
      const [row] = await db`
        insert into inbox (provider, kind, type, user_id, payload)
        values (${provider}, ${kind}, ${type}, ${userId}, ${db.json(clean(payload))})
        returning id
      `;
      return Number(row.id);
    },

    async markInbox(id, status, error = null) {
      await db`update inbox set status = ${status}, error = ${error} where id = ${id}`;
    },

    // Carga inicial

    /** Empieza un backfill (cancela el anterior si seguía en marcha). */
    async startBackfill(userId, provider) {
      await db`
        update backfills set status = 'cancelled', finished_at = now()
        where user_id = ${userId} and provider = ${provider} and status = 'running'
      `;
      const [row] = await db`
        insert into backfills (user_id, provider) values (${userId}, ${provider}) returning id
      `;
      return row.id;
    },

    async setBackfillTotal(id, total) {
      await db`
        update backfills set total = ${total},
          status = case when ${total} = 0 then 'done' else status end,
          finished_at = case when ${total} = 0 then now() else finished_at end
        where id = ${id}
      `;
    },

    /** Un trozo terminado (bien o mal). Cuando están todos, el backfill queda 'done'. */
    async backfillProgress(id, { failed = false } = {}) {
      await db`
        update backfills set
          done = done + ${failed ? 0 : 1},
          failed = failed + ${failed ? 1 : 0},
          status = case when done + failed + 1 >= total and status = 'running' then 'done' else status end,
          finished_at = case when done + failed + 1 >= total then now() else finished_at end
        where id = ${id}
      `;
    },

    async cancelBackfills(userId, provider) {
      await db`
        update backfills set status = 'cancelled', finished_at = now()
        where user_id = ${userId} and provider = ${provider} and status = 'running'
      `;
    },

    async isBackfillActive(id) {
      const [row] = await db`select status from backfills where id = ${id}`;
      return row?.status === 'running';
    },

    /** El último backfill de cada proveedor del usuario. */
    async latestBackfills(userId) {
      const rows = await db`
        select distinct on (provider) * from backfills
        where user_id = ${userId}
        order by provider, started_at desc
      `;
      return Object.fromEntries(
        rows.map((r) => [
          r.provider,
          {
            status: r.status,
            total: r.total,
            done: r.done,
            failed: r.failed,
            startedAt: r.started_at.toISOString(),
            finishedAt: r.finished_at?.toISOString(),
          },
        ]),
      );
    },

    // Límite de peticiones a APIs de fuera (compartido entre workers)

    /**
     * Cuenta una petición en la ventana actual de `key`.
     * @returns {Promise<{ allowed: boolean, retryAfterSeconds: number }>}
     */
    async hitRateLimit(key, limit, windowSeconds) {
      const [row] = await db`
        insert into rate_limits (key, window_start, hits)
        values (
          ${key},
          to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}) * ${windowSeconds}),
          1
        )
        on conflict (key, window_start) do update set hits = rate_limits.hits + 1
        returning hits, extract(epoch from (window_start + make_interval(secs => ${windowSeconds}) - now())) as left
      `;
      return {
        allowed: row.hits <= limit,
        retryAfterSeconds: Math.max(1, Math.ceil(Number(row.left))),
      };
    },

    // Latido de los workers

    async workerBeat({ workerId, hostname, version, startedAt, intervalMs, stats }) {
      await db`
        insert into worker_heartbeats (worker_id, hostname, version, started_at, interval_ms, stats)
        values (
          ${workerId}, ${hostname}, ${version}, ${new Date(startedAt)}, ${intervalMs},
          ${db.json(clean(stats))}
        )
        on conflict (worker_id) do update set
          last_seen_at = now(), version = excluded.version, interval_ms = excluded.interval_ms,
          stats = excluded.stats
      `;
    },

    /** Workers que han latido en el último día, el más reciente primero. */
    async workerHeartbeats() {
      const rows = await db`
        select *, extract(epoch from now() - last_seen_at) * 1000 as age_ms
        from worker_heartbeats
        where last_seen_at > now() - interval '1 day'
        order by last_seen_at desc
      `;
      return rows.map((r) => ({
        workerId: r.worker_id,
        hostname: r.hostname,
        version: r.version,
        startedAt: r.started_at.toISOString(),
        lastSeenAt: r.last_seen_at.toISOString(),
        intervalMs: r.interval_ms,
        // Tres latidos perdidos seguidos = caído
        status: Number(r.age_ms) > r.interval_ms * 3 ? 'stale' : 'ok',
        stats: r.stats,
      }));
    },

    /** Lo último que ha llegado de fuera, sin el payload (puede llevar textos de comidas). */
    async recentInbox({ limit = 50 } = {}) {
      const rows = await db`
        select id, received_at, provider, kind, type, status, error
        from inbox
        order by id desc
        limit ${limit}
      `;
      return rows.map((r) => ({
        id: Number(r.id),
        receivedAt: r.received_at.toISOString(),
        provider: r.provider,
        kind: r.kind,
        type: r.type,
        status: r.status,
        error: r.error,
      }));
    },

    /**
     * Últimos trabajos de la cola, del historial de pg-boss (guarda los acabados 7 días). Del
     * `data` solo lo que dice qué se hizo, nunca el contenido. Sin `name` se saltan los de
     * normalizar: hay uno por cada descarga con cambios y taparían el resto.
     * @param {{ limit?: number, failed?: boolean, name?: string }} [options]
     */
    async recentJobs({ limit = 50, failed = false, name } = {}) {
      const rows = await db`
        select id, name, state, retry_count, created_on, started_on, completed_on,
          data->>'provider' as provider, coalesce(data->>'kind', data->>'documentId') as kind,
          data->>'from' as "from", data->>'to' as "to", data->>'reason' as reason,
          output
        from pgboss.job
        where name not like '\\_\\_pgboss%'
          ${failed ? db`and state = 'failed'` : db``}
          ${name ? db`and name = ${name}` : db`and name <> 'normalize'`}
        order by created_on desc
        limit ${limit}
      `;
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        state: r.state,
        retryCount: r.retry_count,
        provider: r.provider,
        kind: r.kind,
        from: r.from,
        to: r.to,
        reason: r.reason,
        createdAt: r.created_on.toISOString(),
        startedAt: r.started_on?.toISOString() ?? null,
        completedAt: r.completed_on?.toISOString() ?? null,
        ms: r.started_on && r.completed_on ? r.completed_on - r.started_on : null,
        // Hecho: el resumen que devuelve el handler; fallido: el mensaje de error
        result: r.state === 'failed' ? null : r.output,
        error: r.state === 'failed' ? String(r.output?.message ?? '').slice(0, 300) : null,
      }));
    },

    /** Últimas copias de seguridad (job db-backup). */
    async recentBackups({ limit = 5 } = {}) {
      const rows = await db`select * from backup_runs order by started_at desc limit ${limit}`;
      return rows.map((r) => ({
        id: Number(r.id),
        startedAt: r.started_at.toISOString(),
        finishedAt: r.finished_at?.toISOString() ?? null,
        status: r.status,
        file: r.file,
        sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes),
        pruned: r.pruned,
        error: r.error,
      }));
    },

    /** Trabajos acabados por cola en las últimas `hours` horas (sobrevive a reinicios). */
    async jobCounts({ hours = 24 } = {}) {
      const rows = await db`
        select name, state, count(*)::int as count
        from pgboss.job
        where completed_on > now() - make_interval(hours => ${hours})
          and state in ('completed', 'failed') and name not like '\\_\\_pgboss%'
        group by name, state
      `;
      const out = {};
      for (const r of rows) (out[r.name] ??= { completed: 0, failed: 0 })[r.state] = r.count;
      return out;
    },

    /** Limpieza: buzón ya procesado de hace más de `days` días y contadores viejos. */
    async cleanup({ inboxDays = 30 } = {}) {
      const inbox = await db`
        delete from inbox
        where received_at < now() - make_interval(days => ${inboxDays}) and status <> 'error'
      `;
      await db`delete from rate_limits where window_start < now() - interval '1 day'`;
      await db`delete from worker_heartbeats where last_seen_at < now() - interval '7 days'`;
      return { inbox: inbox.count };
    },
  };
}

/** Quita los undefined antes de ir a jsonb. */
function clean(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}
