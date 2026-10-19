import express, { Router } from 'express';
import { createWebhookHandler } from '@digitaltwin/google-health';

/**
 * Endpoint de notificaciones de Google Health.
 * Responde enseguida (204, como pide Google) y procesa los avisos después, sin bloquear la respuesta.
 */
export function createGoogleHealthWebhookRouter({
  secret,
  bodyLimit,
  onNotifications,
  ...options
}) {
  const handle = createWebhookHandler({ secret, ...options });
  const router = Router();

  router.post('/', express.raw({ type: '*/*', limit: bodyLimit }), async (req, res, next) => {
    try {
      const result = await handle({ headers: req.headers, body: req.body ?? Buffer.alloc(0) });

      if (result.type === 'rejected') {
        req.log.warn({ reason: result.reason }, 'google-health webhook rechazado');
        return res.status(result.status).end();
      }
      res.status(result.status).end();

      if (result.type === 'verification') {
        req.log.info('google-health webhook verificado');
        return;
      }

      req.log.info(
        {
          count: result.notifications.length,
          notifications: result.notifications.map(({ healthUserId, dataType, operation }) => ({
            healthUserId,
            dataType,
            operation,
          })),
        },
        'google-health notificaciones recibidas',
      );
      if (onNotifications) {
        Promise.resolve(onNotifications(result.notifications)).catch((err) =>
          req.log.error({ err }, 'google-health error procesando notificaciones'),
        );
      }
    } catch (error) {
      next(error);
    }
  });

  return router;
}
