import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** Prefijo reconocible (escáneres de secretos, logs) y que lo distingue de las API keys. */
export const TOKEN_PREFIX = 'dt_';

const hash = (token) => createHash('sha256').update(token).digest();
const newToken = () => TOKEN_PREFIX + randomBytes(32).toString('base64url');

const fromRow = (row) => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at.toISOString(),
  lastUsedAt: row.last_used_at?.toISOString() ?? null,
});

/**
 * Tokens personales en la BD (tabla personal_tokens). El token en claro solo sale de `create`.
 * @param {{ db: import('postgres').Sql }} deps
 */
export function createDbPersonalTokens({ db }) {
  return {
    async create({ userId, name }) {
      const token = newToken();
      const [row] = await db`
        insert into personal_tokens (user_id, name, token_hash)
        values (${userId}, ${name}, ${hash(token)})
        returning *
      `;
      return { ...fromRow(row), token };
    },

    /** Usuario dueño del token, o null si no existe o está revocado. Apunta el último uso. */
    async verify(token) {
      if (!token?.startsWith(TOKEN_PREFIX)) return null;
      const [row] = await db`
        update personal_tokens set last_used_at = now()
        where token_hash = ${hash(token)} and revoked_at is null
        returning user_id, id
      `;
      return row ? { userId: row.user_id, tokenId: row.id } : null;
    },

    async list(userId) {
      const rows = await db`
        select * from personal_tokens
        where user_id = ${userId} and revoked_at is null
        order by created_at
      `;
      return rows.map(fromRow);
    },

    /** true si existía (y era suyo). */
    async revoke(userId, id) {
      const rows = await db`
        update personal_tokens set revoked_at = now()
        where id = ${id} and user_id = ${userId} and revoked_at is null
        returning id
      `;
      return rows.length > 0;
    },
  };
}

/** Lo mismo en memoria (tests y arranque sin BD). */
export function createMemoryPersonalTokens() {
  const tokens = new Map();

  return {
    async create({ userId, name }) {
      const token = newToken();
      const entry = {
        id: randomUUID(),
        userId,
        name,
        hash: hash(token).toString('hex'),
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
      };
      tokens.set(entry.id, entry);
      return { ...view(entry), token };
    },

    async verify(token) {
      if (!token?.startsWith(TOKEN_PREFIX)) return null;
      const digest = hash(token).toString('hex');
      const entry = [...tokens.values()].find((t) => t.hash === digest);
      if (!entry) return null;
      entry.lastUsedAt = new Date().toISOString();
      return { userId: entry.userId, tokenId: entry.id };
    },

    async list(userId) {
      return [...tokens.values()].filter((t) => t.userId === userId).map(view);
    },

    async revoke(userId, id) {
      const entry = tokens.get(id);
      if (entry?.userId !== userId) return false;
      return tokens.delete(id);
    },
  };
}

function view({ id, name, createdAt, lastUsedAt }) {
  return { id, name, createdAt, lastUsedAt };
}
