import { HttpError } from '../utils/http-error.js';
import { apiKeyAuth } from './api-key-auth.js';
import { hasFeature, isActive, publicUser } from '../services/users.js';

/**
 * Quién llama: un cliente con API key (`Authorization: Bearer`, p. ej. el bot) o una persona con
 * sesión (cookie). Deja `req.apiClient` o `req.user`.
 * @param {object} deps
 * @param {{ client: string, key: string }[]} deps.apiKeys
 * @param {ReturnType<typeof import('../services/sessions.js').createSessions>} deps.sessions
 * @param {ReturnType<typeof import('../services/users.js').createUserStore>} deps.users
 */
export function authenticate({ apiKeys, sessions, users }) {
  const byKey = apiKeys.length ? apiKeyAuth(apiKeys) : null;

  return async (req, res, next) => {
    if (req.headers.authorization) {
      if (!byKey) return next(HttpError.unauthorized('API key no válida'));
      return byKey(req, res, next);
    }
    const userId = await sessions.read(req);
    const user = userId && (await users.findById(userId));
    // Desactivado o caducado: la sesión que tuviera deja de valer en la siguiente petición
    if (!user || !isActive(user))
      return next(HttpError.unauthorized('Inicia sesión', { code: 'NO_SESSION' }));
    req.user = publicUser(user);
    req.log = req.log?.child({ user: user.id }) ?? req.log;
    next();
  };
}

/** Solo personas con sesión (no API keys): sus datos y sus conexiones. */
export function requireUser(req, _res, next) {
  if (req.user) return next();
  next(HttpError.forbidden('Hace falta una sesión de usuario', { code: 'USER_REQUIRED' }));
}

/** Solo clientes con API key (bot, procesos). */
export function requireApiClient(req, _res, next) {
  if (req.apiClient) return next();
  next(HttpError.forbidden('Solo para clientes con API key', { code: 'API_CLIENT_REQUIRED' }));
}

/** @param {string} role p. ej. Role.ADMIN */
export function requireRole(role) {
  return (req, _res, next) => {
    if (req.user?.role === role) return next();
    next(HttpError.forbidden('No tienes permiso para esto', { code: 'ROLE_REQUIRED' }));
  };
}

/** @param {string} feature p. ej. 'experimental-connections' (los admin las tienen todas) */
export function requireFeature(feature) {
  return (req, _res, next) => {
    if (req.user && hasFeature(req.user, feature)) return next();
    next(HttpError.forbidden('Esto no está activado en tu cuenta', { code: 'FEATURE_REQUIRED' }));
  };
}
