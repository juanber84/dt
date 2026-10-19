import postgres from 'postgres';

/**
 * Pool de conexiones a Postgres. Se usa con tagged templates (parametrizado, sin inyección):
 * `await sql\`select * from measurements where user_id = ${id}\``
 * @param {string} url  postgres://usuario:clave@host:puerto/bd
 * @param {import('postgres').Options<{}>} [options]
 */
export function createDb(url, options = {}) {
  return postgres(url, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    // Los NOTICE ("ya existe, se omite"...) no aportan nada en los logs
    onnotice: () => {},
    connection: { application_name: 'digitaltwin' },
    ...options,
  });
}

/** Comprueba que la BD responde (readiness). */
export async function ping(sql) {
  await sql`select 1`;
}
