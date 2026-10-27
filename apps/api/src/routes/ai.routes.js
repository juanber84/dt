import { Router } from 'express';
import { z } from 'zod';
import { AI_PROVIDERS, testProvider } from '@digitaltwin/llm-usage';
import { validate } from '../middlewares/validate.js';
import { HttpError } from '../utils/http-error.js';

const providerBody = z.object({
  provider: z.enum(Object.keys(AI_PROVIDERS)),
  model: z.string().trim().min(1).max(120),
  /** Vacío: la que ya tenía (para cambiar solo el modelo). */
  apiKey: z.string().trim().max(500).optional(),
});

/**
 * /api/v1/ai: la IA del usuario de la sesión (Cuenta → IA).
 *   GET    /           límite del día, lo gastado hoy, su proveedor y la lista de proveedores
 *   PUT    /provider   { provider, model, apiKey? }: la prueba y, si va, la guarda (cifrada)
 *   DELETE /provider   vuelve a la IA de la app (con su límite)
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/llm-usage').createAiAccess>} deps.access
 */
export function createAiRouter({ access }) {
  const router = Router();

  const status = async (userId) => ({
    ...(await access.status(userId)),
    providers: Object.entries(AI_PROVIDERS).map(([id, p]) => ({
      id,
      label: p.label,
      modelHint: p.modelHint,
      keysUrl: p.keysUrl,
    })),
  });

  router.get('/', async (req, res) => {
    res.json(await status(req.user.id));
  });

  router.put('/provider', validate({ body: providerBody }), async (req, res) => {
    if (!access.canStoreKeys) {
      throw new HttpError(503, 'El servidor no puede guardar claves (falta TOKEN_ENCRYPTION_KEY)', {
        code: 'NO_ENCRYPTION_KEY',
      });
    }
    const { provider, model } = req.validated.body;
    const apiKey = req.validated.body.apiKey || (await access.storedKey(req.user.id));
    if (!apiKey) throw HttpError.badRequest('Falta la clave', { code: 'API_KEY_REQUIRED' });

    const problem = await testProvider({ apiKey, baseUrl: AI_PROVIDERS[provider].baseUrl, model });
    if (problem) throw HttpError.badRequest(problem, { code: 'PROVIDER_TEST_FAILED' });

    await access.saveProvider(req.user.id, { provider, model, apiKey });
    req.log?.info({ provider, model }, 'Clave de IA propia guardada');
    res.json(await status(req.user.id));
  });

  router.delete('/provider', async (req, res) => {
    await access.removeProvider(req.user.id);
    res.json(await status(req.user.id));
  });

  return router;
}
