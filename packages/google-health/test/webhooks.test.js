import { describe, it, expect } from 'vitest';
import {
  createWebhookHandler,
  notificationToQuery,
  parseNotifications,
  parseTinkKeyset,
} from '../src/webhooks.js';
import { createTestKeyset } from '../src/testing.js';

const SECRET = 'Bearer test-secret';
const { keyset, sign } = createTestKeyset(4193570438);
const handler = createWebhookHandler({ secret: SECRET, keyset });

const notification = {
  data: {
    version: '1',
    clientProvidedSubscriptionName: 'sub',
    healthUserId: 'hu-1',
    operation: 'UPSERT',
    dataType: 'steps',
    intervals: [
      {
        physicalTimeInterval: {
          startTime: '2026-03-08T01:29:00Z',
          endTime: '2026-03-08T01:34:00Z',
        },
        civilIso8601TimeInterval: {
          startTime: '2026-03-07T17:29:00',
          endTime: '2026-03-07T17:34:00',
        },
      },
    ],
  },
};

describe('parseTinkKeyset', () => {
  it('carga claves P-256 válidas', () => {
    const keys = parseTinkKeyset(keyset);
    expect(keys.get(4193570438).key.asymmetricKeyDetails.namedCurve).toBe('prime256v1');
  });
});

describe('createWebhookHandler', () => {
  it('responde 200 a la verificación autenticada y 401 a la no autenticada', async () => {
    const body = '{"type":"verification"}';
    expect(await handler({ headers: { authorization: SECRET }, body })).toMatchObject({
      status: 200,
      type: 'verification',
    });
    expect((await handler({ headers: {}, body })).status).toBe(401);
  });

  it('acepta notificaciones firmadas y responde 204', async () => {
    const body = Buffer.from(JSON.stringify([notification]));
    const result = await handler({
      headers: { authorization: SECRET, 'google-health-api-signature': sign(body) },
      body,
    });
    expect(result.status).toBe(204);
    expect(result.notifications[0]).toMatchObject({
      healthUserId: 'hu-1',
      dataType: 'steps',
      operation: 'UPSERT',
      subscriptionName: 'sub',
    });
  });

  it('rechaza body manipulado', async () => {
    const body = JSON.stringify(notification);
    const result = await handler({
      headers: { authorization: SECRET, 'google-health-api-signature': sign(body) },
      body: body.replace('steps', 'sleep'),
    });
    expect(result).toMatchObject({ status: 401, reason: 'Firma no válida' });
  });

  it('rechaza secreto incorrecto', async () => {
    const body = JSON.stringify(notification);
    const result = await handler({
      headers: { authorization: 'Bearer otro', 'google-health-api-signature': sign(body) },
      body,
    });
    expect(result.status).toBe(401);
  });

  it('acepta el secreto anterior durante una rotación', async () => {
    const rotating = createWebhookHandler({
      secret: 'Bearer new',
      previousSecrets: [SECRET],
      keyset,
    });
    const body = '{"type":"verification"}';
    expect((await rotating({ headers: { authorization: SECRET }, body })).status).toBe(200);
  });

  it('acepta el secreto configurado sin "Bearer " delante', async () => {
    const bare = createWebhookHandler({ secret: 'test-secret', keyset });
    const body = '{"type":"verification"}';
    expect((await bare({ headers: { authorization: SECRET }, body })).status).toBe(200);
    expect((await bare({ headers: { authorization: 'test-secret' }, body })).status).toBe(401);
  });
});

describe('notificaciones', () => {
  it('parseNotifications acepta objeto o array, con o sin envoltorio data', () => {
    expect(parseNotifications(notification)).toHaveLength(1);
    expect(parseNotifications([notification.data, notification])).toHaveLength(2);
  });

  it('DELETE de sleep conserva recordId', () => {
    const [n] = parseNotifications({
      data: { operation: 'DELETE', dataType: 'sleep', recordId: 'r1' },
    });
    expect(n.recordId).toBe('r1');
  });

  it('notificationToQuery con tiempo físico', () => {
    const [n] = parseNotifications(notification);
    expect(notificationToQuery(n)).toEqual({
      dataType: 'steps',
      from: new Date('2026-03-08T01:29:00Z'),
      to: new Date('2026-03-08T01:34:01Z'),
    });
  });

  it('notificationToQuery con solo hora local amplía un día', () => {
    const [n] = parseNotifications({
      data: {
        dataType: 'daily-resting-heart-rate',
        intervals: [
          {
            civilIso8601TimeInterval: {
              startTime: '2026-03-07T00:00:00',
              endTime: '2026-03-08T00:00:00',
            },
          },
        ],
      },
    });
    const q = notificationToQuery(n);
    expect(q.from.toISOString()).toBe('2026-03-06T00:00:00.000Z');
    expect(q.to.toISOString()).toBe('2026-03-09T00:00:01.000Z');
  });
});
