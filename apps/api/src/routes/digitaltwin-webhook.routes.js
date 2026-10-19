import express, { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { mealEntrySchema } from '@digitaltwin/nutrition';
import { HttpError } from '../utils/http-error.js';

export const SIGNATURE_HEADER = 'x-digitaltwin-signature';
const TOLERANCE_SECONDS = 300;

const eventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('meal.logged'),
    telegramUserId: z.number().int().positive(),
    data: mealEntrySchema,
  }),
  z.object({
    type: z.literal('account.link'),
    telegramUserId: z.number().int().positive(),
    data: z.object({
      code: z.string().trim().min(4).max(32),
      username: z.string().max(64).optional(),
    }),
  }),
  z.object({
    type: z.literal('sync.requested'),
    telegramUserId: z.number().int().positive(),
    data: z.object({ provider: z.enum(['xiaomi', 'google-health']) }),
  }),
]);

/**
 * Firma `t=<unix>,v1=<hmac>` de un cuerpo: HMAC-SHA256 de "<t>.<cuerpo>" con el secreto.
 * La usa el bot para mandar y la API para comprobar.
 */
export function signBody(body, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

/** Comprueba la firma (y que no sea de hace más de 5 minutos: evita que se reenvíe). */
export function verifySignature(header, body, secret, now = Date.now()) {
  const parts = Object.fromEntries(
    String(header ?? '')
      .split(',')
      .map((part) => part.trim().split('=')),
  );
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !parts.v1) return false;
  if (Math.abs(now / 1000 - timestamp) > TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(signBody(body, secret, timestamp).split('v1=')[1], 'hex');
  const received = Buffer.from(parts.v1, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * /webhooks/digitaltwin: eventos de nuestras apps (el bot), firmados con
 * DIGITALTWIN_WEBHOOK_SECRET. Responde 202 en cuanto el evento queda guardado.
 * @param {object} deps
 * @param {string} deps.secret
 * @param {string} deps.bodyLimit
 * @param {ReturnType<typeof import('../services/inbox.js').createInbox>} deps.inbox
 */
export function createDigitaltwinWebhookRouter({ secret, bodyLimit, inbox }) {
  const router = Router();
  router.post('/', express.raw({ type: '*/*', limit: bodyLimit }), async (req, res) => {
    const body = req.body?.length ? req.body.toString('utf8') : '';
    if (!verifySignature(req.headers[SIGNATURE_HEADER], body, secret)) {
      throw HttpError.unauthorized('Firma no válida', { code: 'INVALID_SIGNATURE' });
    }
    let json;
    try {
      json = JSON.parse(body);
    } catch {
      throw HttpError.badRequest('El cuerpo no es JSON');
    }
    const parsed = eventSchema.safeParse(json);
    if (!parsed.success) {
      throw HttpError.badRequest('Evento no válido', {
        code: 'VALIDATION_ERROR',
        details: parsed.error.issues,
      });
    }
    res.status(202).json(await inbox.digitaltwinEvent(parsed.data));
  });
  return router;
}
