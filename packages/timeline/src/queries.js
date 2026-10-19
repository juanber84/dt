/**
 * Lecturas del timeline.
 *
 * Valor canónico: en cada hora y métrica manda el proveedor con mejor prioridad
 * (source_priorities: la de la métrica o, si no hay, la general); dentro de él, el origen con mejor
 * prioridad (origin_priorities, p. ej. el Apple Watch dentro de Google) y luego el stream con
 * más muestras (el más completo). Así un mismo paso contado por el reloj y el móvil no se suma
 * dos veces. Los días se agregan desde esas horas ya resueltas, en la zona horaria que se pida.
 *
 * @param {object} deps
 * @param {import('postgres').Sql} deps.db
 * @param {ReturnType<typeof import('./catalog.js').createCatalog>} deps.catalog
 */
export function createTimelineQueries({ db, catalog }) {
  async function metricRows(codes) {
    const all = await catalog.list();
    if (!codes?.length) return all;
    const wanted = new Set(codes);
    return all.filter((m) => wanted.has(m.code));
  }

  return {
    /**
     * Series canónicas por hora o día.
     * @param {object} q
     * @param {string} q.userId
     * @param {Date} q.from
     * @param {Date} q.to
     * @param {'hour'|'day'} [q.bucket]
     * @param {string[]} [q.metrics]  códigos; por defecto todos los que tengan datos
     * @param {string} [q.timeZone]   para los días
     * @returns {Promise<Record<string, { unit: string, aggregation: string, points: object[] }>>}
     */
    async series({ userId, from, to, bucket = 'day', metrics, timeZone = 'UTC' }) {
      const list = await metricRows(metrics);
      if (!list.length) return {};
      const byId = new Map(list.map((m) => [m.id, m]));
      const ids = list.map((m) => m.id);

      const rows =
        bucket === 'hour'
          ? await db`
              with resolved as (${resolvedHours(db, { userId, ids, from, to })})
              select bucket as t, metric_id, provider, avg, min, max, sum, count, last
              from resolved
              order by metric_id, bucket
            `
          : await db`
              with resolved as (${resolvedHours(db, { userId, ids, from, to })})
              select
                time_bucket(interval '1 day', bucket, ${timeZone}) as t,
                metric_id,
                (array_agg(provider order by count desc))[1] as provider,
                sum(sum) / nullif(sum(count), 0) as avg,
                min(min) as min,
                max(max) as max,
                sum(sum) as sum,
                sum(count)::int as count,
                last(last, bucket) as last
              from resolved
              group by 1, metric_id
              order by metric_id, 1
            `;

      const out = {};
      for (const row of rows) {
        const metric = byId.get(row.metric_id);
        const entry = (out[metric.code] ??= {
          label: metric.label,
          unit: metric.unit,
          aggregation: metric.aggregation,
          points: [],
        });
        entry.points.push({
          t: row.t.toISOString(),
          value: round(Number(row[metric.aggregation])),
          min: round(Number(row.min)),
          max: round(Number(row.max)),
          count: Number(row.count),
          provider: row.provider,
        });
      }
      return out;
    },

    /**
     * Episodios (comidas, entrenos, sueño, pesajes...) que empiezan en [from, to).
     * Con `canonical` (por defecto), las comidas de un día solo salen del proveedor con mejor
     * prioridad que tenga comidas ese día (si apuntas con el bot, las de Google no se suman), y un
     * entreno que se solapa con otro de un proveedor con más prioridad no sale (la misma salida en
     * bici por intervals.icu y por Google).
     */
    async episodes({ userId, from, to, kinds, canonical = true, timeZone = 'UTC' }) {
      const rows = await db`
        with found as (
          select e.*, s.provider, s.origin, s.details as origin_details,
            coalesce(p.priority, 100) as priority,
            (e.start_time at time zone ${timeZone})::date as local_day
          from episodes e
          join streams s on s.id = e.stream_id
          left join source_priorities p on p.metric_id is null and p.provider = s.provider
          where e.user_id = ${userId}
            and e.start_time >= ${from} and e.start_time < ${to}
            and e.deleted_at is null
            ${kinds?.length ? db`and e.kind = any(${kinds})` : db``}
        )
        select * from found f
        ${
          canonical
            ? db`where not (f.kind = 'meal' and exists (
                select 1 from found b
                where b.kind = 'meal' and b.local_day = f.local_day and b.priority < f.priority
              ))
              and not (f.kind = 'workout' and exists (
                select 1 from found b
                where b.kind = 'workout' and b.priority < f.priority
                  and b.start_time < coalesce(f.end_time, f.start_time + interval '1 minute')
                  and coalesce(b.end_time, b.start_time + interval '1 minute') > f.start_time
              ))`
            : db``
        }
        order by f.start_time
      `;
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        start: r.start_time.toISOString(),
        end: r.end_time?.toISOString() ?? null,
        title: r.title,
        summary: r.summary,
        schema: r.schema,
        details: r.details,
        provider: r.provider,
        origin: r.origin_details,
      }));
    },

    /** Datos crudos de una métrica (para hacer zoom en un rango corto), de todas las fuentes. */
    async observations({ userId, metric, from, to, limit = 10_000 }) {
      const found = await catalog.get(metric);
      if (!found) return [];
      const rows = await db`
        select o.time, o.end_time, o.value, s.provider, s.origin
        from observations o
        join streams s on s.id = o.stream_id
        where o.user_id = ${userId} and o.metric_id = ${found.id}
          and o.time >= ${from} and o.time < ${to}
        order by o.time, s.provider
        limit ${limit}
      `;
      return rows.map((r) => ({
        t: r.time.toISOString(),
        end: r.end_time?.toISOString() ?? null,
        value: r.value,
        provider: r.provider,
        origin: r.origin,
      }));
    },

    /** Métricas con datos del usuario, con su rango de fechas. */
    async availableMetrics(userId) {
      const rows = await db`
        select metric_id, min(bucket) as first, max(bucket) as last, sum(count)::bigint as count
        from observations_hourly where user_id = ${userId}
        group by metric_id
      `;
      const out = [];
      for (const row of rows) {
        const metric = await catalog.byId(row.metric_id);
        if (!metric) continue;
        out.push({
          code: metric.code,
          label: metric.label,
          unit: metric.unit,
          aggregation: metric.aggregation,
          first: row.first.toISOString(),
          last: row.last.toISOString(),
          count: Number(row.count),
        });
      }
      return out.sort((a, b) => a.code.localeCompare(b.code));
    },
  };
}

/** Horas resueltas: una fila por (hora, métrica), del stream que manda. */
function resolvedHours(db, { userId, ids, from, to }) {
  return db`
    select distinct on (h.bucket, h.metric_id)
      h.bucket, h.metric_id, s.provider, h.avg, h.min, h.max, h.sum, h.count, h.last
    from observations_hourly h
    join streams s on s.id = h.stream_id
    left join source_priorities pm on pm.metric_id = h.metric_id and pm.provider = s.provider
    left join source_priorities pd on pd.metric_id is null and pd.provider = s.provider
    left join lateral (
      select min(op.priority) as priority
      from origin_priorities op
      where op.provider = s.provider and s.origin like op.origin_pattern
        and (op.metric_id is null or op.metric_id = h.metric_id)
    ) o on true
    where h.user_id = ${userId}
      and h.metric_id = any(${ids}::smallint[])
      and h.bucket >= ${from} and h.bucket < ${to}
    order by h.bucket, h.metric_id, coalesce(pm.priority, pd.priority, 100),
      coalesce(o.priority, 100), h.count desc
  `;
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}
