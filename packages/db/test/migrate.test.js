import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createDb, migrate, ping, MIGRATIONS_DIR } from '../src/index.js';

// Necesita una BD de verdad: TEST_DATABASE_URL=postgres://... (p. ej. la de make docker-up).
// Cada ejecución trabaja en un schema propio que se borra al final.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('migrate', () => {
  const schema = `test_${randomBytes(4).toString('hex')}`;
  let admin;
  let sql;

  beforeAll(async () => {
    admin = createDb(url, { max: 1 });
    await admin.unsafe(`create schema ${schema}`);
    sql = createDb(url, { connection: { search_path: `${schema},public` } });
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop schema if exists ${schema} cascade`);
    await admin?.end();
  });

  const dirWith = async (files) => {
    const dir = await mkdtemp(join(tmpdir(), 'dt-migrations-'));
    for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
    return dir;
  };

  it('ping responde', async () => {
    await expect(ping(sql)).resolves.toBeUndefined();
  });

  it('aplica las migraciones del paquete y no repite', async () => {
    expect(await migrate(sql)).toContain('0001_timescaledb.sql');
    expect(await migrate(sql)).toEqual([]);
    const [{ count }] = await sql`select count(*)::int from schema_migrations`;
    expect(count).toBeGreaterThan(0);
    expect(MIGRATIONS_DIR).toMatch(/migrations$/);

    // 0006: el agregado por hora se recalcula cada 2 minutos
    const [{ every }] = await sql`
      select j.schedule_interval::text as every
      from timescaledb_information.jobs j
      where j.proc_name = 'policy_refresh_continuous_aggregate'
        and j.hypertable_schema = ${schema}
    `;
    expect(every).toBe('00:02:00');
  });

  it('aplica en orden por nombre y solo las que faltan', async () => {
    const dir = await dirWith({
      '0002_b.sql': 'insert into t values (2);',
      '0001_a.sql': 'create table t (n int);',
    });
    expect(await migrate(sql, { dir })).toEqual(['0001_a.sql', '0002_b.sql']);
    await writeFile(join(dir, '0003_c.sql'), 'insert into t values (3);');
    expect(await migrate(sql, { dir })).toEqual(['0003_c.sql']);
    expect((await sql`select n from t order by n`).map((r) => r.n)).toEqual([2, 3]);
  });

  it('si una falla, deshace su transacción y no la apunta', async () => {
    const dir = await dirWith({
      '0001_ok.sql': 'create table ok (n int);',
      '0002_ko.sql': 'create table ko (n int); select * from no_existe;',
    });
    await expect(migrate(sql, { dir })).rejects.toThrow(/0002_ko\.sql/);
    const [{ exists }] = await sql`select to_regclass('ko') is not null as exists`;
    expect(exists).toBe(false);
    const names = (await sql`select name from schema_migrations`).map((r) => r.name);
    expect(names).toContain('0001_ok.sql');
    expect(names).not.toContain('0002_ko.sql');
  });

  it('dos procesos a la vez no aplican la misma migración dos veces', async () => {
    const dir = await dirWith({ '0001_once.sql': 'create table once (n int);' });
    const results = await Promise.all([migrate(sql, { dir }), migrate(sql, { dir })]);
    expect(results.flat()).toEqual(['0001_once.sql']);
  });
});
