import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middlewares/validate.js';
import { HttpError } from '../utils/http-error.js';

const registerBody = z.object({
  // Lo que devuelve startRegistration() en el navegador: lo valida la librería
  response: z.looseObject({ id: z.string().min(1), response: z.looseObject({}) }),
  name: z.string().trim().min(1).max(60).default('Este dispositivo'),
});

const REASONS = {
  challenge: 'Ha caducado: vuelve a intentarlo',
  unverified: 'El dispositivo no lo ha confirmado',
  invalid: 'El dispositivo no lo ha confirmado',
};

/**
 * Por qué no se ha podido. La librería lanza si la respuesta no cuadra (origen, reto, firma).
 * @param {() => Promise<{ ok: boolean, reason?: string }>} fn
 */
export async function attempt(fn) {
  try {
    return await fn();
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

/**
 * /api/v1/passkeys (con sesión): las passkeys del usuario, darlas de alta y quitarlas.
 * @param {{ passkeys: ReturnType<typeof import('../services/passkeys.js').createPasskeys> }} deps
 */
export function createPasskeysRouter({ passkeys }) {
  const router = Router();

  router.get('/', async (req, res) => {
    const list = await passkeys.list(req.user.id);
    res.json({
      items: list.map(({ id, name, deviceType, backedUp, createdAt, lastUsedAt }) => ({
        id,
        name,
        synced: deviceType === 'multiDevice' || backedUp,
        createdAt,
        lastUsedAt,
      })),
    });
  });

  router.post('/options', async (req, res) => {
    res.json(await passkeys.registrationOptions(res, req.user));
  });

  router.post('/', validate({ body: registerBody }), async (req, res) => {
    const { response, name } = req.validated.body;
    const result = await attempt(() => passkeys.register(req, res, req.user, response, name));
    if (!result.ok) {
      throw HttpError.badRequest(REASONS[result.reason], { code: 'PASSKEY_NOT_REGISTERED' });
    }
    req.log?.info({ passkey: result.id }, 'Passkey dada de alta');
    res.status(201).json({ id: result.id });
  });

  router.delete('/:id', async (req, res) => {
    if (!(await passkeys.remove(req.user.id, req.params.id))) throw HttpError.notFound();
    res.status(204).end();
  });

  return router;
}
