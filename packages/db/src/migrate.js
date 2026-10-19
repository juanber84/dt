import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

// Clave del advisory lock: si arrancan dos procesos a la vez, el segundo espera al primero
const LOCK_KEY = 726_173_001;
// Algunas sentencias de Timescale (p. ej. continuous aggregates) no pueden ir en una transacción
const NO_TRANSACTION = /^--\s*no-transaction\b/;

/**
 * Aplica en orden las migraciones `.sql` de `dir` que falten (por nombre de fichero) y las
 * apunta en `schema_migrations`. Cada una va en su transacción salvo que empiece por
 * `-- no-transaction`. Nunca se edita una migración ya aplicada: se crea otra.
 * @param {import('postgres').Sql} sql
 * @param {{ dir?: string, logger?: { info: Function } }} [options]
 * @returns {Promise<string[]>} migraciones aplicadas en esta llamada
 */
export async function migrate(sql, { dir = MIGRATIONS_DIR, logger } = {}) {
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  // Una sola conexión para que el lock (de sesión) y las transacciones vayan juntos
  const conn = await sql.reserve();
  const applied = [];

  try {
    await conn`select pg_advisory_lock(${LOCK_KEY})`;
    await conn`
      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `;
    const done = new Set((await conn`select name from schema_migrations`).map((row) => row.name));

    for (const file of files.filter((name) => !done.has(name))) {
      const content = await readFile(join(dir, file), 'utf8');
      const transactional = !NO_TRANSACTION.test(content);
      try {
        if (transactional) await conn.unsafe('begin');
        await conn.unsafe(content);
        await conn`insert into schema_migrations (name) values (${file})`;
        if (transactional) await conn.unsafe('commit');
      } catch (err) {
        if (transactional) await conn.unsafe('rollback');
        throw new Error(`Migración ${file} fallida: ${err.message}`, { cause: err });
      }
      applied.push(file);
      logger?.info(`Migración aplicada: ${file}`);
    }
  } finally {
    await conn`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
    conn.release();
  }

  return applied;
}
