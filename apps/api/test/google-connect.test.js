import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from './helpers.js';
import { testUsers, loginCookie } from './auth-helpers.js';

const env = { GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'secreto' };
const TOKENS = {
  access_token: 'ya29.acceso',
  refresh_token: '1//refresco',
  scope: 'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  healthUserId: 'hu_1',
};

async function setup(extraEnv = env) {
  const googleAuth = {
    getAuthUrl: vi.fn(({ state }) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`),
    exchangeCode: vi.fn(async (code) => {
      if (code !== 'buen-codigo') throw new Error('invalid_grant');
      return TOKENS;
    }),
    revoke: vi.fn(async () => {}),
  };
  const app = buildApp(extraEnv, {
    users: await testUsers(),
    googleAuth,
    googleDescribeAccount: async () => ({ dataTypes: 1, devices: [{ name: 'Pixel Watch 3' }] }),
  });
  const session = await loginCookie(app);
  return { app, session, googleAuth };
}

/** Empieza el OAuth y devuelve el state y la cookie que lo liga al navegador. */
async function start(app, session) {
  const res = await request(app)
    .post('/api/v1/connections/google-health/connect')
    .set('Cookie', session);
  const state = new URL(res.body.url).searchParams.get('state');
  const cookie = res.headers['set-cookie'].find((c) => c.startsWith('dt_oauth_state='));
  return { res, state, cookie };
}

const callback = (app, query, cookie) => {
  const req = request(app).get(
    `/api/v1/connections/google-health/callback?${new URLSearchParams(query)}`,
  );
  return cookie ? req.set('Cookie', cookie.split(';')[0]) : req;
};

const back = (params) =>
  `http://localhost:3081/admin/connections?${new URLSearchParams({ provider: 'google-health', ...params })}`;

describe('Google Health por OAuth', () => {
  it('connect da la URL de Google y liga el state al navegador con una cookie Lax', async () => {
    const { app, session, googleAuth } = await setup();
    const { res, state, cookie } = await start(app, session);
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^https:\/\/accounts\.google\.com\//);
    // Pide leer todo y escribir comidas y medidas
    const { scopes } = googleAuth.getAuthUrl.mock.calls[0][0];
    expect(scopes).toContain('https://www.googleapis.com/auth/googlehealth.nutrition.writeonly');
    expect(scopes).toContain(
      'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.writeonly',
    );
    expect(scopes).toContain('https://www.googleapis.com/auth/googlehealth.sleep.readonly');
    expect(state.length).toBeGreaterThan(20);
    expect(cookie).toContain(`dt_oauth_state=${state}`);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\/api\/v1\/connections\/google-health\/callback/);
  });

  it('callback correcto: guarda la conexión (sin sesión, por el state) y vuelve a Conexiones', async () => {
    const { app, session, googleAuth } = await setup();
    const { state, cookie } = await start(app, session);
    const res = await callback(app, { state, code: 'buen-codigo' }, cookie);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(back({ result: 'connected' }));
    expect(googleAuth.exchangeCode).toHaveBeenCalledWith('buen-codigo');

    const list = await request(app).get('/api/v1/connections').set('Cookie', session);
    const google = list.body.items.find((c) => c.id === 'google-health');
    expect(google).toMatchObject({
      available: true,
      status: 'connected',
      account: 'Cuenta de Google',
      details: { devices: [{ name: 'Pixel Watch 3' }] },
    });
    expect(JSON.stringify(list.body)).not.toMatch(/ya29|refresco/);

    // El state es de un solo uso
    const again = await callback(app, { state, code: 'buen-codigo' }, cookie);
    expect(again.headers.location).toBe(back({ result: 'error', reason: 'expired' }));
  });

  it('sin la cookie del navegador que empezó, no vale', async () => {
    const { app, session } = await setup();
    const { state } = await start(app, session);
    const res = await callback(app, { state, code: 'buen-codigo' });
    expect(res.headers.location).toBe(back({ result: 'error', reason: 'expired' }));
  });

  it('si rechazas el permiso o Google no acepta el código, vuelve con el motivo', async () => {
    const { app, session } = await setup();
    const denied = await start(app, session);
    expect(
      (await callback(app, { state: denied.state, error: 'access_denied' }, denied.cookie)).headers
        .location,
    ).toBe(back({ result: 'error', reason: 'denied' }));

    const bad = await start(app, session);
    expect(
      (await callback(app, { state: bad.state, code: 'malo' }, bad.cookie)).headers.location,
    ).toBe(back({ result: 'error', reason: 'exchange' }));
  });

  it('desconectar revoca el permiso en Google', async () => {
    const { app, session, googleAuth } = await setup();
    const { state, cookie } = await start(app, session);
    await callback(app, { state, code: 'buen-codigo' }, cookie);
    const res = await request(app)
      .delete('/api/v1/connections/google-health')
      .set('Cookie', session);
    expect(res.status).toBe(204);
    expect(googleAuth.revoke).toHaveBeenCalledWith(TOKENS);
  });

  it('sin GOOGLE_CLIENT_ID/SECRET sale como no disponible y connect da 503', async () => {
    const { app, session } = await setup({});
    const list = await request(app).get('/api/v1/connections').set('Cookie', session);
    expect(list.body.items.find((c) => c.id === 'google-health').available).toBe(false);
    const res = await request(app)
      .post('/api/v1/connections/google-health/connect')
      .set('Cookie', session);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('NOT_CONFIGURED');
  });

  it('connect exige sesión', async () => {
    const { app } = await setup();
    expect((await request(app).post('/api/v1/connections/google-health/connect')).status).toBe(401);
  });
});
