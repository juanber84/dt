export const DEFAULT_SETTINGS = Object.freeze({ dailyEnabled: true, dailyTime: '07:30' });

const day = (value) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

function toReport(r) {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    periodFrom: day(r.period_from),
    periodTo: day(r.period_to),
    createdAt: r.created_at.toISOString(),
    ...(r.blocks && { blocks: r.blocks }),
  };
}

/**
 * Informes y preferencias en la BD (migración 0021). Todo por usuario.
 * @param {{ db: import('postgres').Sql }} deps
 */
export function createDbReportStore({ db }) {
  return {
    /** Guarda un informe; el de la mañana de un día que ya existía se reemplaza. */
    async save(userId, report) {
      const values = {
        user_id: userId,
        kind: report.kind,
        title: report.title,
        period_from: report.periodFrom,
        period_to: report.periodTo,
        blocks: db.json(report.blocks),
      };
      const [row] =
        report.kind === 'daily'
          ? await db`
              insert into reports ${db(values)}
              on conflict (user_id, period_from) where kind = 'daily' do update set
                title = excluded.title, blocks = excluded.blocks, created_at = now()
              returning *
            `
          : await db`insert into reports ${db(values)} returning *`;
      return toReport(row);
    },
    async dailyExists(userId, date) {
      const [row] = await db`
        select 1 from reports where user_id = ${userId} and kind = 'daily' and period_from = ${date}
      `;
      return Boolean(row);
    },
    /** Lista sin los bloques (pesan). */
    async list(userId, limit = 30) {
      const rows = await db`
        select id, kind, title, period_from, period_to, created_at from reports
        where user_id = ${userId} order by period_from desc, created_at desc limit ${limit}
      `;
      return rows.map(toReport);
    },
    async get(userId, id) {
      const [row] = await db`select * from reports where user_id = ${userId} and id = ${id}`;
      return row ? toReport(row) : null;
    },

    async settings(userId) {
      const [row] = await db`select * from report_settings where user_id = ${userId}`;
      return row
        ? { dailyEnabled: row.daily_enabled, dailyTime: String(row.daily_time).slice(0, 5) }
        : { ...DEFAULT_SETTINGS };
    },
    async saveSettings(userId, s) {
      await db`
        insert into report_settings (user_id, daily_enabled, daily_time)
        values (${userId}, ${s.dailyEnabled}, ${s.dailyTime})
        on conflict (user_id) do update set
          daily_enabled = excluded.daily_enabled, daily_time = excluded.daily_time,
          updated_at = now()
      `;
    },
    /** Todos los usuarios con su correo y sus preferencias (las de por defecto si no tienen). */
    async recipients() {
      const rows = await db`
        select u.id, u.email, u.name,
          coalesce(s.daily_enabled, ${DEFAULT_SETTINGS.dailyEnabled}) as daily_enabled,
          coalesce(s.daily_time, ${DEFAULT_SETTINGS.dailyTime}::time) as daily_time
        from users u left join report_settings s on s.user_id = u.id
      `;
      return rows.map((r) => ({
        userId: r.id,
        email: r.email,
        name: r.name,
        dailyEnabled: r.daily_enabled,
        dailyTime: String(r.daily_time).slice(0, 5),
      }));
    },
  };
}
