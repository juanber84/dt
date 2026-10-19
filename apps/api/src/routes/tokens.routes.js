import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middlewares/validate.js';
import { HttpError } from '../utils/http-error.js';

const createBody = z.object({ name: z.string().trim().min(1).max(80) });
const idParams = z.object({ id: z.uuid() });

/**
 * /api/v1/tokens: tokens personales del usuario de la sesión (para conectar Claude por MCP).
 *   GET    /       los suyos (sin el token)
 *   POST   /       crea uno: { name } → el token en claro, solo esta vez
 *   DELETE /:id    lo revoca
 */
export function createTokensRouter({ tokens }) {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json({ items: await tokens.list(req.user.id) });
  });

  router.post('/', validate({ body: createBody }), async (req, res) => {
    const created = await tokens.create({ userId: req.user.id, name: req.validated.body.name });
    res.status(201).json(created);
  });

  router.delete('/:id', validate({ params: idParams }), async (req, res) => {
    const revoked = await tokens.revoke(req.user.id, req.validated.params.id);
    if (!revoked) throw HttpError.notFound('No existe ese token');
    res.status(204).end();
  });

  return router;
}
