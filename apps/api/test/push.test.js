import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from './helpers.js';
import { testUsers, loginCookie } from './auth-helpers.js';

const subscription = {
  endpoint: 'https://web.push.apple.com/abc',
  keys: { p256dh: 'BPk', auth: 'xyz' },
};

let app;
let push;
let ana;
let admin;

beforeAll(async () => {
  push = {
    publicKey: 'BPublica',
    settings: vi.fn(async () => ({
      disabled: [],
      quietFrom: '22:00',
      quietTo: '08:00',
      maxPerDay: 6,
    })),
    devices: vi.fn(async () => []),
    history: vi.fn(async () => []),
    subscribe: vi.fn(async () => {}),
    unsubscribe: vi.fn(async () => {}),
    updateSettings: vi.fn(async (_userId, patch) => patch),
    notify: vi.fn(async () => ({ status: 'sent', delivered: 1 })),
  };
  app = buildApp({}, { users: await testUsers(), push });
  admin = await loginCookie(app);
  ana = await loginCookie(app, 'ana@example.com');
});

describe('/api/v1/push', () => {
  it('sin sesión no hay nada', async () => {
    await request(app).get('/api/v1/push').expect(401);
  });

  it('la clave pública, los tipos de aviso y las preferencias del usuario', async () => {
    const res = await request(app).get('/api/v1/push').set('Cookie', ana).expect(200);
    expect(res.body.publicKey).toBe('BPublica');
    expect(res.body.kinds.map((k) => k.id)).toContain('clinical-ready');
    expect(push.settings).toHaveBeenLastCalledWith('ana');
  });

  it('cada dispositivo se apunta a su usuario; solo endpoints https', async () => {
    await request(app)
      .post('/api/v1/push/subscriptions')
      .set('Cookie', ana)
      .send({ subscription, device: 'iPhone' })
      .expect(201);
    expect(push.subscribe).toHaveBeenLastCalledWith('ana', subscription, 'iPhone');
    await request(app)
      .post('/api/v1/push/subscriptions')
      .set('Cookie', ana)
      .send({ subscription: { ...subscription, endpoint: 'http://evil.example/x' } })
      .expect(400);
  });

  it('preferencias validadas y prueba al propio usuario', async () => {
    await request(app)
      .put('/api/v1/push/settings')
      .set('Cookie', admin)
      .send({ quietFrom: '23:00', disabled: ['meals-missing'] })
      .expect(200);
    expect(push.updateSettings).toHaveBeenLastCalledWith('admin', {
      quietFrom: '23:00',
      disabled: ['meals-missing'],
    });
    await request(app)
      .put('/api/v1/push/settings')
      .set('Cookie', admin)
      .send({ quietFrom: '25:00' })
      .expect(400);
    const res = await request(app).post('/api/v1/push/test').set('Cookie', admin).expect(200);
    expect(res.body).toEqual({ status: 'sent', delivered: 1 });
    expect(push.notify).toHaveBeenLastCalledWith(
      'admin',
      expect.objectContaining({ kind: 'test' }),
    );
  });
});
