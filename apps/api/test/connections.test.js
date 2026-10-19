import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { XiaomiError } from '@digitaltwin/xiaomi';
import { buildApp } from './helpers.js';
import { testUsers, loginCookie } from './auth-helpers.js';

const CREDENTIALS = { userId: '42', serviceToken: 'st', ssecurity: 'ss', passToken: 'pt' };
const CAPTCHA = { image: 'data:image/jpeg;base64,AAAA', mimeType: 'image/jpeg' };

/** XiaomiAuth falso: captcha → código por email → conectado. */
function fakeAuth() {
  return {
    start: vi.fn(async () => ({
      status: 'CAPTCHA_REQUIRED',
      captcha: CAPTCHA,
      captchaRetry: false,
      state: { step: 'captcha', secret: 'hash' },
    })),
    submitCaptcha: vi.fn(async () => ({
      status: 'EMAIL_CODE_REQUIRED',
      state: { step: 'email_code', secret: 'hash' },
    })),
    submitEmailCode: vi.fn(async (_state, code) => {
      if (code !== '123456') {
        throw new XiaomiError('INVALID_EMAIL_CODE', 'Código de verificación incorrecto');
      }
      return { status: 'AUTHENTICATED', credentials: CREDENTIALS };
    }),
  };
}

async function setup(auth = fakeAuth(), deps = {}) {
  const app = buildApp(
    {},
    {
      users: await testUsers(),
      xiaomiAuth: auth,
      xiaomiDescribeAccount: async () => ({
        devices: [{ name: 'Báscula', model: 'yunmai.scales.ms104' }],
      }),
      ...deps,
    },
  );
  const as = (cookie) => ({
    get: (path) => request(app).get(path).set('Cookie', cookie),
    post: (path, body) => request(app).post(path).set('Cookie', cookie).send(body),
    delete: (path) => request(app).delete(path).set('Cookie', cookie),
  });
  const api = as(await loginCookie(app));
  const ana = as(await loginCookie(app, 'ana@example.com'));
  return { app, api, ana, auth };
}

const login = { username: 'yo@example.com', password: 'secreta', region: 'de' };

describe('/api/v1/connections', () => {
  it('lista todos los proveedores, sin conectar al principio', async () => {
    const { api } = await setup();
    const res = await api.get('/api/v1/connections');
    expect(res.status).toBe(200);
    expect(res.body.items.map((c) => c.id)).toEqual([
      'google-health',
      'xiaomi',
      'strava',
      'intervals-icu',
      'fatsecret',
    ]);
    expect(res.body.items.find((c) => c.id === 'xiaomi')).toEqual({
      id: 'xiaomi',
      available: true,
      status: 'disconnected',
    });
  });

  it('exige sesión', async () => {
    const { app } = await setup();
    expect((await request(app).get('/api/v1/connections')).status).toBe(401);
  });

  it('login de Xiaomi completo: captcha, código erróneo, código bueno y desconectar', async () => {
    const { api, ana, auth } = await setup();

    const start = await api.post('/api/v1/connections/xiaomi/login', login);
    expect(start.status).toBe(200);
    expect(start.body).toEqual({
      status: 'CAPTCHA_REQUIRED',
      loginId: expect.any(String),
      captcha: CAPTCHA.image,
      captchaRetry: false,
    });
    expect(auth.start).toHaveBeenCalledWith({ username: login.username, password: 'secreta' });
    // El estado de Xiaomi no sale de la API
    expect(JSON.stringify(start.body)).not.toContain('hash');

    const { loginId } = start.body;
    // Ni con el loginId puede otro usuario seguir el login
    expect(
      (await ana.post(`/api/v1/connections/xiaomi/login/${loginId}/captcha`, { code: 'x' })).status,
    ).toBe(410);
    const captcha = await api.post(`/api/v1/connections/xiaomi/login/${loginId}/captcha`, {
      code: 'ab12',
    });
    expect(captcha.body).toEqual({ status: 'EMAIL_CODE_REQUIRED', loginId });

    const wrong = await api.post(`/api/v1/connections/xiaomi/login/${loginId}/email-code`, {
      code: '000000',
    });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe('INVALID_EMAIL_CODE');

    const ok = await api.post(`/api/v1/connections/xiaomi/login/${loginId}/email-code`, {
      code: '123456',
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      status: 'CONNECTED',
      connection: {
        provider: 'xiaomi',
        status: 'connected',
        account: login.username,
        region: 'de',
        details: { devices: [{ name: 'Báscula' }] },
      },
    });

    const list = await api.get('/api/v1/connections');
    const xiaomi = list.body.items.find((c) => c.id === 'xiaomi');
    expect(xiaomi.status).toBe('connected');
    // Ni el token ni la contraseña llegan al front
    expect(JSON.stringify(list.body)).not.toMatch(/serviceToken|passToken|secreta/);

    // El login ya terminó: el loginId no vale para más
    const again = await api.post(`/api/v1/connections/xiaomi/login/${loginId}/email-code`, {
      code: '123456',
    });
    expect(again.status).toBe(410);

    // Las conexiones son de cada usuario: Ana no ve ni puede borrar la del admin
    const anas = await ana.get('/api/v1/connections');
    expect(anas.body.items.find((c) => c.id === 'xiaomi').status).toBe('disconnected');
    expect((await ana.delete('/api/v1/connections/xiaomi')).status).toBe(404);

    expect((await api.delete('/api/v1/connections/xiaomi')).status).toBe(204);
    expect((await api.delete('/api/v1/connections/xiaomi')).status).toBe(404);
  });

  it('un captcha incorrecto obliga a empezar de nuevo', async () => {
    const auth = fakeAuth();
    auth.submitCaptcha.mockRejectedValueOnce(
      new XiaomiError('INVALID_CAPTCHA', 'CAPTCHA incorrecto'),
    );
    const { api } = await setup(auth);
    const { loginId } = (await api.post('/api/v1/connections/xiaomi/login', login)).body;
    const res = await api.post(`/api/v1/connections/xiaomi/login/${loginId}/captcha`, {
      code: 'mal',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_CAPTCHA');
    const retry = await api.post(`/api/v1/connections/xiaomi/login/${loginId}/captcha`, {
      code: 'ab12',
    });
    expect(retry.status).toBe(410);
  });

  it('usuario o contraseña incorrectos → 422 (no 401, que es la API key)', async () => {
    const auth = fakeAuth();
    auth.start.mockRejectedValueOnce(
      new XiaomiError('INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos'),
    );
    const { api } = await setup(auth);
    const res = await api.post('/api/v1/connections/xiaomi/login', login);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('valida la entrada', async () => {
    const { api } = await setup();
    expect((await api.post('/api/v1/connections/xiaomi/login', { username: 'x' })).status).toBe(
      400,
    );
    expect(
      (await api.post('/api/v1/connections/xiaomi/login/no-es-uuid/captcha', { code: '1' })).status,
    ).toBe(400);
  });

  describe('sincronizar Xiaomi', () => {
    const scale = (iso, weight) => ({
      id: `did1:${Date.parse(iso)}`,
      timestamp: Date.parse(iso),
      weight,
      bodyFat: 15,
      raw: { createTime: Date.parse(iso), secret: 'crudo' },
    });

    async function connected(fetchMeasurements) {
      const ctx = await setup(fakeAuth(), { xiaomiFetchMeasurements: fetchMeasurements });
      const { loginId } = (await ctx.api.post('/api/v1/connections/xiaomi/login', login)).body;
      await ctx.api.post(`/api/v1/connections/xiaomi/login/${loginId}/captcha`, { code: 'ab12' });
      await ctx.api.post(`/api/v1/connections/xiaomi/login/${loginId}/email-code`, {
        code: '123456',
      });
      return ctx;
    }

    it('la primera vez trae todo y luego solo desde la última (con solape), sin duplicar', async () => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce([
          scale('2025-01-10T07:00:00Z', 80),
          scale('2026-10-01T07:00:00Z', 77),
        ])
        .mockResolvedValueOnce([
          scale('2026-10-01T07:00:00Z', 77),
          scale('2026-10-14T07:00:00Z', 76.5),
        ]);
      const { api } = await connected(fetch);

      const first = await api.post('/api/v1/connections/xiaomi/sync');
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ fetched: 2, added: 2, total: 2 });
      expect(fetch.mock.calls[0][1].from).toBeUndefined();
      expect(fetch.mock.calls[0][0].credentials).toMatchObject({ serviceToken: 'st' });

      const second = await api.post('/api/v1/connections/xiaomi/sync');
      expect(second.body).toMatchObject({ fetched: 2, added: 1, total: 3 });
      const lastSync = Date.parse(first.body.connection.lastSync);
      expect(fetch.mock.calls[1][1].from.getTime()).toBe(lastSync - 24 * 3600 * 1000);
      expect(second.body.connection).toMatchObject({
        records: 3,
        firstRecordAt: '2025-01-10T07:00:00.000Z',
        lastRecord: { at: '2026-10-14T07:00:00.000Z', weight: 76.5, bodyFat: 15 },
      });
      expect(JSON.stringify(second.body)).not.toMatch(/serviceToken/);

      const list = await api.get('/api/v1/measurements?source=xiaomi');
      expect(list.body.items).toHaveLength(3);
      expect(list.body.items[0]).toMatchObject({
        source: 'xiaomi',
        externalId: 'did1:1736492400000',
        timestamp: '2025-01-10T07:00:00.000Z',
        values: { weight: 80 },
      });
      expect(list.body.items[0].raw).toBeUndefined();
      const withRaw = await api.get('/api/v1/measurements?source=xiaomi&raw=true');
      expect(withRaw.body.items[0].raw).toEqual({ createTime: 1736492400000, secret: 'crudo' });
    });

    it('guarda el token renovado si Xiaomi lo cambia por el camino', async () => {
      const fetch = vi.fn(async (_connection, { onCredentialsRefreshed }) => {
        await onCredentialsRefreshed({ userId: '42', serviceToken: 'nuevo', ssecurity: 'ss' });
        return [];
      });
      const { api } = await connected(fetch);
      await api.post('/api/v1/connections/xiaomi/sync');
      await api.post('/api/v1/connections/xiaomi/sync');
      expect(fetch.mock.calls[1][0].credentials.serviceToken).toBe('nuevo');
    });

    it('si Xiaomi cierra la sesión, queda para reconectar', async () => {
      const fetch = vi
        .fn()
        .mockRejectedValue(new XiaomiError('SESSION_EXPIRED', 'Xiaomi no aceptó el passToken'));
      const { api } = await connected(fetch);
      const res = await api.post('/api/v1/connections/xiaomi/sync');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('RECONNECT_REQUIRED');
      const list = await api.get('/api/v1/connections');
      expect(list.body.items.find((c) => c.id === 'xiaomi')).toMatchObject({ status: 'expired' });
    });

    it('sin conectar → 409', async () => {
      const { api } = await setup();
      const res = await api.post('/api/v1/connections/xiaomi/sync');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('NOT_CONNECTED');
    });
  });
});
