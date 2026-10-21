import { Router } from 'express';
import { z } from 'zod';
import { KINDS } from '@digitaltwin/push';
import { validate } from '../middlewares/validate.js';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

const subscribeBody = z.object({
  // Lo que da pushManager.subscribe() en el navegador (toJSON)
  subscription: z.object({
    endpoint: z.url().startsWith('https://'),
    keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  }),
  device: z.string().trim().max(60).optional(),
});

const unsubscribeBody = z.object({ endpoint: z.string().min(1) });

const settingsBody = z.object({
  disabled: z.array(z.string()).optional(),
  quietFrom: time.optional(),
  quietTo: time.optional(),
  maxPerDay: z.number().int().min(1).max(50).optional(),
});

/**
 * /api/v1/push (con sesión): avisos push del usuario. Sus dispositivos, qué avisos quiere, horas
 * de silencio, el historial y el botón de prueba.
 * @param {{ push: ReturnType<typeof import('@digitaltwin/push').createPush> }} deps
 */
export function createPushRouter({ push }) {
  const router = Router();

  router.get('/', async (req, res) => {
    const userId = req.user.id;
    const [settings, devices, history] = await Promise.all([
      push.settings(userId),
      push.devices(userId),
      push.history(userId, 10),
    ]);
    res.json({
      publicKey: push.publicKey,
      kinds: Object.entries(KINDS).map(([id, k]) => ({ id, ...k })),
      settings,
      // El endpoint no sale entero: basta con reconocer el propio
      devices: devices.map(({ id, endpoint, device, createdAt, lastSentAt }) => ({
        id,
        endpoint,
        device,
        createdAt,
        lastSentAt,
      })),
      history,
    });
  });

  router.post('/subscriptions', validate({ body: subscribeBody }), async (req, res) => {
    const { subscription, device } = req.validated.body;
    await push.subscribe(req.user.id, subscription, device);
    res.status(201).end();
  });

  router.delete('/subscriptions', validate({ body: unsubscribeBody }), async (req, res) => {
    await push.unsubscribe(req.user.id, req.validated.body.endpoint);
    res.status(204).end();
  });

  router.put('/settings', validate({ body: settingsBody }), async (req, res) => {
    res.json(await push.updateSettings(req.user.id, req.validated.body));
  });

  router.post('/test', async (req, res) => {
    const result = await push.notify(req.user.id, {
      kind: 'test',
      title: 'Así te llegarán los avisos',
      body: 'Toca para volver a Ajustes → Cuenta.',
      url: '/settings',
    });
    res.json(result);
  });

  return router;
}
