import { randomUUID, scrypt, timingSafeEqual, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const PARAMS = { N: 16384, r: 8, p: 1 };

export const Role = Object.freeze({ ADMIN: 'admin', USER: 'user' });

/**
 * Funciones extra que se activan por usuario (Administración → Usuarios). Los administradores las
 * tienen todas.
 */
export const FEATURES = Object.freeze({
  'experimental-connections': {
    label: 'Conexiones experimentales',
    description: 'Báscula y fuerza, que entran por una API no oficial',
  },
});

/** ¿Puede entrar? Ni desactivado ni caducado. */
export const isActive = (user, now = new Date()) =>
  !user.disabledAt && !(user.expiresAt && new Date(user.expiresAt) <= now);

/** Las funciones que tiene de verdad: todas si es admin, si no las que tenga activadas. */
export const featuresOf = (user) =>
  user.role === Role.ADMIN
    ? Object.keys(FEATURES)
    : (user.features ?? []).filter((f) => f in FEATURES);

export const hasFeature = (user, feature) => featuresOf(user).includes(feature);

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
export const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  features: featuresOf(user),
  demo: Boolean(user.demo),
});

/** Lo que ve el administrador en Usuarios: también el estado de la cuenta (nunca el hash). */
export const adminUser = (user) => ({
  ...publicUser(user),
  // Las que tiene activadas (featuresOf añade todas a los admin)
  features: user.features ?? [],
  active: isActive(user),
  expiresAt: user.expiresAt ?? null,
  disabledAt: user.disabledAt ?? null,
  lastLoginAt: user.lastLoginAt ?? null,
  createdAt: user.createdAt ?? null,
  connections: user.connections ?? [],
  // Límite de IA al día propio; null = el de por defecto (AI_DAILY_LIMIT_USD)
  aiDailyLimitUsd: user.aiDailyLimitUsd ?? null,
});

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

    async list() {
      return [...users];
    },

    async create({ email, name, role, password, features = [], demo = false, expiresAt = null }) {
      if (users.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) return null;
      const user = {
        id: randomUUID(),
        email: email.trim(),
        name: name ?? undefined,
        role,
        passwordHash: await hashPassword(password),
        features,
        demo,
        expiresAt,
        disabledAt: null,
        lastLoginAt: null,
        createdAt: new Date().toISOString(),
      };
      users.push(user);
      return user;
    },

    /** Cambia lo que venga en `patch` (name, role, features, demo, expiresAt, disabled, password). */
    async update(id, { password, disabled, ...patch }) {
      const user = users.find((u) => u.id === id);
      if (!user) return null;
      Object.assign(user, patch);
      if (password) user.passwordHash = await hashPassword(password);
      if (disabled !== undefined) {
        user.disabledAt = disabled ? (user.disabledAt ?? new Date().toISOString()) : null;
      }
      return user;
    },

    async remove(id) {
      const i = users.findIndex((u) => u.id === id);
      if (i < 0) return false;
      users.splice(i, 1);
      return true;
    },

    async touchLogin(id) {
      const user = users.find((u) => u.id === id);
      if (user) user.lastLoginAt = new Date().toISOString();
    },
  };
}
