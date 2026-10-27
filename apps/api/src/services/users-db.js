import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from './users.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const iso = (date) => date?.toISOString() ?? null;

const fromRow = (row) => ({
  id: row.id,
  email: row.email,
  name: row.name ?? undefined,
  role: row.role,
  passwordHash: row.password_hash,
  features: row.features ?? [],
  demo: row.demo ?? false,
  expiresAt: iso(row.expires_at),
  disabledAt: iso(row.disabled_at),
  lastLoginAt: iso(row.last_login_at),
  aiDailyLimitUsd: row.ai_daily_limit_usd == null ? null : Number(row.ai_daily_limit_usd),
  createdAt: iso(row.created_at),
  ...(row.connections && { connections: row.connections }),
});

/**
 * Usuarios en la BD (tabla users). Misma interfaz que createUserStore, más `upsert` para el
 * script create-user.
 * @param {{ db: import('postgres').Sql }} deps
 */
export function createDbUserStore({ db }) {
  const dummy = hashPassword(randomUUID());

  return {
    async findById(id) {
      // Un JWT antiguo puede traer un id que no es uuid: es "no existe", no un error de la BD
      if (!UUID.test(String(id))) return null;
      const [row] = await db`select * from users where id = ${id}`;
      return row ? fromRow(row) : null;
    },

    async verify(email, password) {
      const [row] = await db`select * from users where lower(email) = lower(${email.trim()})`;
      const ok = await verifyPassword(password, row?.password_hash ?? (await dummy));
      return row && ok ? fromRow(row) : null;
    },

    /** Todos, con los proveedores que tiene conectados cada uno. */
    async list() {
      const rows = await db`
        select u.*, array(
          select c.provider from connections c where c.user_id = u.id order by c.provider
        ) as connections
        from users u order by u.created_at
      `;
      return rows.map(fromRow);
    },

    /** Da de alta; null si el email ya existe. */
    async create({ email, name, role, password, features = [], demo = false, expiresAt = null }) {
      const passwordHash = await hashPassword(password);
      const [row] = await db`
        insert into users (email, name, role, password_hash, features, demo, expires_at)
        values (${email.trim()}, ${name ?? null}, ${role}, ${passwordHash}, ${features},
          ${demo}, ${expiresAt})
        on conflict (lower(email)) do nothing
        returning *
      `;
      return row ? fromRow(row) : null;
    },

    /** Cambia lo que venga en `patch` (name, role, features, demo, expiresAt, disabled, password). */
    async update(id, { password, disabled, ...patch }) {
      if (!UUID.test(String(id))) return null;
      const columns = {
        ...('name' in patch && { name: patch.name ?? null }),
        ...('role' in patch && { role: patch.role }),
        ...('features' in patch && { features: patch.features }),
        ...('demo' in patch && { demo: patch.demo }),
        ...('expiresAt' in patch && { expires_at: patch.expiresAt }),
        ...('aiDailyLimitUsd' in patch && { ai_daily_limit_usd: patch.aiDailyLimitUsd }),
        ...(password && { password_hash: await hashPassword(password) }),
        updated_at: new Date(),
      };
      const [row] = await db`
        update users set ${db(columns)},
          disabled_at = case
            when ${disabled ?? null}::boolean is null then disabled_at
            when ${disabled ?? null}::boolean then coalesce(disabled_at, now())
            else null
          end
        where id = ${id}
        returning *
      `;
      return row ? fromRow(row) : null;
    },

    /** Borra el usuario y, en cascada, todos sus datos. */
    async remove(id) {
      if (!UUID.test(String(id))) return false;
      const rows = await db`delete from users where id = ${id} returning id`;
      return rows.length > 0;
    },

    async touchLogin(id) {
      await db`update users set last_login_at = now() where id = ${id}`;
    },

    /** Crea el usuario o, si el email ya existe, le cambia nombre, rol y contraseña. */
    async upsert({ email, name, role, password }) {
      const passwordHash = await hashPassword(password);
      const [row] = await db`
        insert into users (email, name, role, password_hash)
        values (${email.trim()}, ${name ?? null}, ${role}, ${passwordHash})
        on conflict (lower(email)) do update set
          name = excluded.name,
          role = excluded.role,
          password_hash = excluded.password_hash,
          updated_at = now()
        returning *, (xmax = 0) as created
      `;
      return { user: fromRow(row), created: row.created };
    },
  };
}
