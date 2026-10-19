import { randomUUID, scrypt, timingSafeEqual, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const PARAMS = { N: 16384, r: 8, p: 1 };

export const Role = Object.freeze({ ADMIN: 'admin', USER: 'user' });

/** "scrypt$N$r$p$salt$hash" (base64url). */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(actual, expected);
}

/** Lo que puede salir de la API: nunca el hash. */
export const publicUser = ({ id, email, name, role }) => ({ id, email, name, role });

/**
 * Usuarios en memoria (tests, o la API sin BD). Con BD se usa createDbUserStore.
 * @param {Array<{ id: string, email: string, name?: string, role: string, passwordHash: string }>} [users]
 */
export function createUserStore(users = []) {
  // Para un email que no existe también se calcula un scrypt: así no se sabe por el tiempo de
  // respuesta qué emails son usuarios
  const dummy = hashPassword(randomUUID());

  return {
    async findById(id) {
      return users.find((u) => u.id === id) ?? null;
    },

    /** Devuelve el usuario si la contraseña es correcta; si no, null. */
    async verify(email, password) {
      const user = users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
      const ok = await verifyPassword(password, user?.passwordHash ?? (await dummy));
      return user && ok ? user : null;
    },
  };
}
