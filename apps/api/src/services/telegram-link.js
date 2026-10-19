import { randomInt } from 'node:crypto';

export const TELEGRAM = 'telegram';
// Sin letras que se confundan (0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Vincular la cuenta de Telegram con el usuario de la web:
 *   start (web, con sesión) → código de un solo uso que caduca
 *   finish (bot, por el webhook firmado: sabe quién eres en Telegram) → guarda la conexión
 * Hacen falta los dos lados a la vez: la sesión de la web y la cuenta de Telegram.
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/connections').createMemoryConnectionStore>} deps.connections
 * @param {{ findById: (id: string) => Promise<object|null> }} deps.users
 * @param {number} [deps.ttlMs]
 * @param {() => number} [deps.now]
 */
export function createTelegramLink({ connections, users, ttlMs = 10 * 60_000, now = Date.now }) {
  const pending = new Map();

  return {
    ttlMs,

    /** @returns {{ code: string, expiresAt: string }} */
    start(userId) {
      for (const [code, link] of pending) {
        if (link.expiresAt <= now() || link.userId === userId) pending.delete(code);
      }
      const code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
      const expiresAt = now() + ttlMs;
      pending.set(code, { userId, expiresAt });
      return { code, expiresAt: new Date(expiresAt).toISOString() };
    },

    /**
     * El bot trae el código: si vale, esa cuenta de Telegram queda a nombre del usuario (y deja
     * de estar vinculada a cualquier otro).
     * @returns {Promise<{ userId: string, email: string|null } | null>} null si no vale
     */
    async finish(code, { telegramUserId, username }) {
      const key = String(code ?? '')
        .trim()
        .toUpperCase();
      const link = pending.get(key);
      pending.delete(key);
      if (!link || link.expiresAt <= now()) return null;

      const previous = await connections.findByExternalUser(TELEGRAM, telegramUserId);
      if (previous && previous.userId !== link.userId) {
        await connections.remove(previous.userId, TELEGRAM);
      }
      await connections.save({
        userId: link.userId,
        provider: TELEGRAM,
        status: 'connected',
        account: username ? `@${username}` : `Telegram ${telegramUserId}`,
        externalUserId: String(telegramUserId),
        connectedAt: new Date(now()).toISOString(),
      });
      const user = await users.findById(link.userId);
      return { userId: link.userId, email: user?.email ?? null };
    },
  };
}
