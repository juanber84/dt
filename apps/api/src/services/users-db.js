import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from './users.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fromRow = (row) => ({
  id: row.id,
  email: row.email,
  name: row.name ?? undefined,
  role: row.role,
  passwordHash: row.password_hash,
});

/**
 * Usuarios en la BD (tabla users). Misma interfaz que createUserStore, más `upsert` para crearlos
 * a mano mientras no haya registro.
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
