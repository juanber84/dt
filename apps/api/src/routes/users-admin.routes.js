import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middlewares/validate.js';
import { HttpError } from '../utils/http-error.js';
import { adminUser, FEATURES, Role } from '../services/users.js';

const fields = {
  email: z.email().max(200),
  name: z.string().trim().max(80).nullable(),
  role: z.enum([Role.ADMIN, Role.USER]),
  password: z.string().min(8).max(200),
  features: z.array(z.enum(Object.keys(FEATURES))).transform((f) => [...new Set(f)]),
  demo: z.boolean(),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
};
const createBody = z.object({
  ...fields,
  name: fields.name.optional(),
  role: fields.role.default(Role.USER),
  // Sin contraseña se genera una y se devuelve una sola vez
  password: fields.password.optional(),
  features: fields.features.default([]),
  demo: fields.demo.default(false),
  expiresAt: fields.expiresAt.default(null),
});
const updateBody = z
  .object({ ...fields, disabled: z.boolean() })
  .omit({ email: true })
  .partial();
const idParams = z.object({ id: z.string().min(1).max(64) });

/** 12 caracteres fáciles de copiar y de dictar: sin 0/O ni 1/l/I. */
const generatePassword = () =>
  randomBytes(12)
    .toString('base64url')
    .replace(/[-_0O1lI]/g, '')
    .padEnd(12, 'x')
    .slice(0, 12);

/**
 * /api/v1/admin/users (solo admin): dar de alta, editar, desactivar y borrar usuarios, y activarles
 * funciones extra (FEATURES). Uno no puede quitarse a sí mismo el admin, ni desactivarse ni borrarse.
 * @param {object} deps
 * @param {ReturnType<typeof import('../services/users.js').createUserStore>} deps.users
 * @param {() => Promise<void>} [deps.onAccessChanged]  Desactivado, reactivado, otra caducidad
 *   o borrado: sus conexiones dejan (o vuelven) a sincronizarse.
 */
export function createUsersAdminRouter({ users, onAccessChanged = async () => {} }) {
  const router = Router();

  router.get('/', async (_req, res) => {
    res.json({
      items: (await users.list()).map(adminUser),
      features: Object.entries(FEATURES).map(([id, f]) => ({ id, ...f })),
    });
  });

  router.post('/', validate({ body: createBody }), async (req, res) => {
    const body = req.validated.body;
    const password = body.password ?? generatePassword();
    const user = await users.create({ ...body, password });
    if (!user) throw HttpError.conflict('Ya hay un usuario con ese email', { code: 'EMAIL_TAKEN' });
    req.log?.info({ created: user.id, demo: user.demo }, 'Usuario creado');
    res
      .status(201)
      .json({ user: adminUser(user), ...(!body.password && { generatedPassword: password }) });
  });

  router.patch('/:id', validate({ params: idParams, body: updateBody }), async (req, res) => {
    const { id } = req.validated.params;
    const patch = req.validated.body;
    if (id === req.user.id && (patch.disabled || (patch.role && patch.role !== Role.ADMIN))) {
      throw HttpError.conflict('No puedes quitarte el admin ni desactivarte a ti mismo', {
        code: 'SELF',
      });
    }
    const user = await users.update(id, patch);
    if (!user) throw HttpError.notFound('No existe ese usuario', { code: 'NOT_FOUND' });
    req.log?.info({ updated: id, fields: Object.keys(patch) }, 'Usuario cambiado');
    if ('disabled' in patch || 'expiresAt' in patch) await onAccessChanged();
    res.json({ user: adminUser(user) });
  });

  router.delete('/:id', validate({ params: idParams }), async (req, res) => {
    const { id } = req.validated.params;
    if (id === req.user.id) {
      throw HttpError.conflict('No puedes borrarte a ti mismo', { code: 'SELF' });
    }
    if (!(await users.remove(id))) {
      throw HttpError.notFound('No existe ese usuario', { code: 'NOT_FOUND' });
    }
    req.log?.info({ removed: id }, 'Usuario borrado');
    await onAccessChanged();
    res.status(204).end();
  });

  return router;
}
