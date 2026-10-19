import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createTestKeyset } from '@digitaltwin/google-health/testing';
import { createLogger } from '@digitaltwin/logger';
import { loadConfig } from '../src/config/env.js';
import { createApp } from '../src/app.js';

const SECRET = 'Bearer secreto-de-pruebas-largo';
const { keyset, sign } = createTestKeyset();

function buildApp(onHealthNotifications, env = { GOOGLE_HEALTH_WEBHOOK_SECRET: SECRET }) {
  return createApp({
    config: loadConfig({ NODE_ENV: 'test', ...env }),
    logger: createLogger({ level: 'silent', pretty: false }),
    onHealthNotifications,
    googleHealthWebhook: { keyset },
  });
}

const body = JSON.stringify([
  { data: { healthUserId: 'hu-1', dataType: 'steps', operation: 'UPSERT', intervals: [] } },
]);

describe('POST /webhooks/google-health', () => {
  it('pasa la verificación de Google (200 con secreto, 401 sin él)', async () => {
    const app = buildApp();
    const verification = '{"type":"verification"}';
    await request(app)
      .post('/webhooks/google-health')
      .set('Authorization', SECRET)
      .set('Content-Type', 'application/json')
      .send(verification)
      .expect(200);
    await request(app)
      .post('/webhooks/google-health')
      .set('Content-Type', 'application/json')
      .send(verification)
      .expect(401);
  });

  it('responde 204 y entrega las notificaciones firmadas', async () => {
    const onHealthNotifications = vi.fn();
    await request(buildApp(onHealthNotifications))
      .post('/webhooks/google-health')
      .set('Authorization', SECRET)
      .set('Content-Type', 'application/json')
      .set('GOOGLE-HEALTH-API-SIGNATURE', sign(body))
      .send(body)
      .expect(204);

    expect(onHealthNotifications).toHaveBeenCalledWith([
      expect.objectContaining({ healthUserId: 'hu-1', dataType: 'steps', operation: 'UPSERT' }),
    ]);
  });

  it('rechaza firmas no válidas', async () => {
    const onHealthNotifications = vi.fn();
    await request(buildApp(onHealthNotifications))
      .post('/webhooks/google-health')
      .set('Authorization', SECRET)
      .set('Content-Type', 'application/json')
      .set('GOOGLE-HEALTH-API-SIGNATURE', sign('otro body'))
      .send(body)
      .expect(401);
    expect(onHealthNotifications).not.toHaveBeenCalled();
  });

  it('no existe si no hay secreto configurado', async () => {
    await request(buildApp(undefined, {})).post('/webhooks/google-health').send('{}').expect(404);
  });
});
