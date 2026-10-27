import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { buildApp } from './helpers.js';
import { testUsers, loginCookie, PASSWORD } from './auth-helpers.js';
import { verifyPassword, hashPassword, Role } from '../src/services/users.js';
import { requireRole } from '../src/middlewares/authenticate.js';
import { errorHandler } from '../src/middlewares/error-handler.js';

const BOT = 'clave-del-bot-0123456789';
let app;

beforeAll(async () => {
  app = buildApp({ DIGITALTWIN_API_KEYS: `bot:${BOT}` }, { users: await testUsers() });
});

describe('/api/v1/auth', () => {
  it('login correcto: cookie HttpOnly y SameSite=Strict con un JWT, y el usuario sin hash', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'Admin@Example.com ', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: {
        id: 'admin',
        email: 'admin@example.com',
        name: 'Admin',
        role: 'admin',
        features: ['experimental-connections'],
        demo: false,
      },
    });
    const [cookie] = res.headers['set-cookie'];
    expect(cookie).toMatch(/^dt_session=ey[\w-]+\.[\w-]+\.[\w-]+;/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    // Sin "mantener la sesión": cookie de sesión del navegador
    expect(cookie).not.toMatch(/Max-Age/);
  });

  it('"mantener la sesión" pone 30 días', async () => {
    const [cookie] = await loginCookie(app, 'admin@example.com', { remember: true });
    expect(cookie).toMatch(/Max-Age=2592000/);
  });

  it('contraseña o usuario incorrectos → 401 INVALID_CREDENTIALS', async () => {
    for (const body of [
      { username: 'admin@example.com', password: 'otra' },
      { username: 'nadie@example.com', password: PASSWORD },
    ]) {
      const res = await request(app).post('/api/v1/auth/login').send(body);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('/session dice quién soy con la cookie y 401 sin ella', async () => {
    const cookie = await loginCookie(app, 'ana@example.com');
    const me = await request(app).get('/api/v1/auth/session').set('Cookie', cookie);
    expect(me.body.user).toMatchObject({ id: 'ana', role: 'user' });
    const none = await request(app).get('/api/v1/auth/session');
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe('NO_SESSION');
  });

  it('un JWT manipulado no vale', async () => {
    const [cookie] = await loginCookie(app);
    const token = cookie.split(';')[0].split('=')[1];
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', iss: 'digitaltwin' })).toString(
      'base64url',
    );
    const res = await request(app)
      .get('/api/v1/auth/session')
      .set('Cookie', `dt_session=${header}.${forged}.${signature}`);
    expect(res.status).toBe(401);
  });

  it('un JWT de otra instancia (otra clave) no vale', async () => {
    const other = buildApp({}, { users: await testUsers() });
    const cookie = await loginCookie(other);
    expect((await request(app).get('/api/v1/auth/session').set('Cookie', cookie)).status).toBe(401);
  });

  it('logout borra la cookie', async () => {
    const res = await request(app).post('/api/v1/auth/logout');
    expect(res.status).toBe(204);
    expect(res.headers['set-cookie'][0]).toMatch(/^dt_session=;.*Expires=Thu, 01 Jan 1970/);
  });
});

describe('quién puede entrar a cada sitio', () => {
  it('sin sesión ni API key → 401', async () => {
    expect((await request(app).get('/api/v1/connections')).status).toBe(401);
  });

  it('las conexiones son de personas: con sesión sí, con la API key del bot no', async () => {
    const cookie = await loginCookie(app);
    expect((await request(app).get('/api/v1/connections').set('Cookie', cookie)).status).toBe(200);
    const bot = await request(app).get('/api/v1/connections').set('Authorization', `Bearer ${BOT}`);
    expect(bot.status).toBe(403);
    expect(bot.body.error.code).toBe('USER_REQUIRED');
  });

  it('el latido es de clientes: con sesión no', async () => {
    const cookie = await loginCookie(app);
    const res = await request(app)
      .post('/api/v1/heartbeat')
      .set('Cookie', cookie)
      .send({ intervalMs: 60_000, startedAt: new Date().toISOString() });
    expect(res.status).toBe(403);
  });

  it('requireRole deja pasar solo al rol pedido', async () => {
    const mini = express();
    mini.use((req, _res, next) => {
      req.user = { id: 'x', role: req.headers['x-role'] };
      next();
    });
    mini.get('/', requireRole(Role.ADMIN), (_req, res) => res.json({ ok: true }));
    mini.use(errorHandler({ isProduction: false }));
    expect((await request(mini).get('/').set('x-role', 'admin')).status).toBe(200);
    const denied = await request(mini).get('/').set('x-role', 'user');
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('ROLE_REQUIRED');
  });
});

describe('contraseñas', () => {
  it('scrypt: verifica la buena y rechaza la mala', async () => {
    const hash = await hashPassword('patata');
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await verifyPassword('patata', hash)).toBe(true);
    expect(await verifyPassword('patatas', hash)).toBe(false);
    expect(await verifyPassword('patata', 'basura')).toBe(false);
  });
});
