/**
 * Conexiones en la BD (tabla connections). Misma interfaz que createMemoryConnectionStore (memory-store.js).
 * Lo común va en columnas, las credenciales cifradas y el resto del objeto en `data` (jsonb):
 * cada conector guarda ahí lo suyo sin tocar el esquema.
 * @param {object} deps
 * @param {import('postgres').Sql} deps.db
 * @param {ReturnType<typeof import('./secret-box.js').createSecretBox>} deps.box
 * @param {import('pino').Logger} [deps.logger]
 */
export function createDbConnectionStore({ db, box, logger }) {
  const context = (userId, provider) => `connections:${userId}:${provider}`;

  function fromRow(row) {
    const connection = {
      ...row.data,
      userId: row.user_id,
      provider: row.provider,
      status: row.status,
      account: row.account ?? undefined,
      externalUserId: row.external_user_id ?? undefined,
      error: row.last_error ?? undefined,
      connectedAt: row.connected_at.toISOString(),
      lastSync: row.last_sync_at?.toISOString(),
      credentials: null,
    };
    if (row.credentials) {
      try {
        connection.credentials = box.open(row.credentials, context(row.user_id, row.provider));
      } catch (err) {
        // Clave cambiada o dato corrupto: no se puede usar, hay que volver a conectar
        logger?.warn({ err: err.message, provider: row.provider }, 'Credenciales ilegibles');
        connection.status = 'expired';
        connection.error = 'No se pueden leer las credenciales guardadas: vuelve a conectar';
      }
    }
    return connection;
  }

  return {
    async get(userId, provider) {
      const [row] = await db`
        select * from connections where user_id = ${userId} and provider = ${provider}
      `;
      return row ? fromRow(row) : null;
    },

    async list(userId) {
      const rows = await db`select * from connections where user_id = ${userId} order by provider`;
      return rows.map(fromRow);
    },

    async findByExternalUser(provider, externalUserId) {
      const [row] = await db`
        select * from connections
        where provider = ${provider} and external_user_id = ${String(externalUserId)}
      `;
      return row ? fromRow(row) : null;
    },

    async listByProvider(provider) {
      const rows = await db`
        select * from connections where provider = ${provider} and status = 'connected'
      `;
      return rows.map(fromRow);
    },

    async save(connection) {
      const {
        userId,
        provider,
        status,
        account,
        externalUserId,
        credentials,
        error,
        connectedAt,
        lastSync,
        ...data
      } = connection;
      const sealed = credentials ? box.seal(credentials, context(userId, provider)) : null;
      // JSON.parse(JSON.stringify()) quita los undefined antes de ir a jsonb
      const json = JSON.parse(JSON.stringify(data));
      await db`
        insert into connections (
          user_id, provider, status, account, external_user_id, credentials, data, last_error,
          connected_at, last_sync_at
        ) values (
          ${userId}, ${provider}, ${status}, ${account ?? null}, ${externalUserId ?? null},
          ${sealed}, ${db.json(json)},
          ${error ?? null}, ${connectedAt ?? new Date().toISOString()}, ${lastSync ?? null}
        )
        on conflict (user_id, provider) do update set
          status = excluded.status,
          account = excluded.account,
          external_user_id = excluded.external_user_id,
          credentials = excluded.credentials,
          data = excluded.data,
          last_error = excluded.last_error,
          connected_at = excluded.connected_at,
          last_sync_at = excluded.last_sync_at,
          updated_at = now()
      `;
      return connection;
    },

    async remove(userId, provider) {
      const result = await db`
        delete from connections where user_id = ${userId} and provider = ${provider}
      `;
      return result.count > 0;
    },
  };
}
