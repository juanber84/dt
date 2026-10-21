import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middlewares/validate.js';

// null = borrar lo escrito (vuelve a salir lo de la báscula)
const profileBody = z.object({
  birthDate: z.iso.date().nullable().optional(),
  sex: z.enum(['male', 'female']).nullable().optional(),
  heightCm: z.number().min(50).max(260).nullable().optional(),
  weightGoalKg: z.number().min(20).max(400).nullable().optional(),
});

/**
 * /api/v1/profile (con sesión): edad, sexo, altura y peso objetivo del usuario.
 * @param {{ profiles: ReturnType<typeof import('../services/profile.js').createProfiles> }} deps
 */
export function createProfileRouter({ profiles }) {
  const router = Router();
  router.get('/', async (req, res) => res.json(await profiles.get(req.user.id)));
  router.put('/', validate({ body: profileBody }), async (req, res) => {
    res.json(await profiles.save(req.user.id, req.validated.body));
  });
  return router;
}
