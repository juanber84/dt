import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { validate } from '../middlewares/validate.js';
import { HttpError } from '../utils/http-error.js';
import { publicUser } from '../services/users.js';

const loginBody = z.object({
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200),
  remember: z.boolean().default(false),
});

/**
 * /api/v1/auth: entrar, salir y quién soy.
 * @param {object} deps
 * @param {ReturnType<typeof import('../services/users.js').createUserStore>} deps.users
 * @param {ReturnType<typeof import('../services/sessions.js').createSessions>} deps.sessions
 * @param {boolean} [deps.limitAttempts]  Límite de intentos fallidos (se quita en tests).
 */
export function createAuthRouter({ users, sessions, limitAttempts = true }) {
  const router = Router();

  // 10 intentos fallidos cada 15 min por IP: probar contraseñas a lo bruto no sale a cuenta
  const attempts = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => !limitAttempts,
    handler: (_req, _res, next) =>
      next(
        new HttpError(429, 'Demasiados intentos, espera un poco', { code: 'TOO_MANY_REQUESTS' }),
      ),
  });

  router.post('/login', attempts, validate({ body: loginBody }), async (req, res) => {
    const { username, password, remember } = req.validated.body;
    const user = await users.verify(username, password);
    if (!user) {
      throw HttpError.unauthorized('Usuario o contraseña incorrectos', {
        code: 'INVALID_CREDENTIALS',
      });
    }
    await sessions.start(res, user, { remember });
    req.log?.info({ user: user.id }, 'Sesión iniciada');
    res.json({ user: publicUser(user) });
  });

  router.post('/logout', (_req, res) => {
    sessions.end(res);
    res.status(204).end();
  });

  router.get('/session', async (req, res) => {
    const userId = await sessions.read(req);
    const user = userId && (await users.findById(userId));
    if (!user) throw HttpError.unauthorized('No hay sesión', { code: 'NO_SESSION' });
    res.json({ user: publicUser(user) });
  });

  return router;
}
