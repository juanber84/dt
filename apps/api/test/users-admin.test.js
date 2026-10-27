import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from './helpers.js';
import { testUsers, loginCookie, PASSWORD } from './auth-helpers.js';

async function setup() {
  const users = await testUsers();
  const app = buildApp({}, { users });
  const as = (cookie) => ({
    get: (path) => request(app).get(path).set('Cookie', cookie),
    post: (path, body) => request(app).post(path).set('Cookie', cookie).send(body),
    patch: (path, body) => request(app).patch(path).set('Cookie', cookie).send(body),
    delete: (path) => request(app).delete(path).set('Cookie', cookie),
  });
  return {
    app,
    users,
    admin: as(await loginCookie(app)),
    ana: as(await loginCookie(app, 'ana@example.com')),
  };
}

const login = (app, username, password = PASSWORD) =>
  request(app).post('/api/v1/auth/login').send({ username, password });

describe('/api/v1/admin/users', () => {
  it('solo para administradores', async () => {
    const { ana } = await setup();
    expect((await ana.get('/api/v1/admin/users')).status).toBe(403);
  });

  it('lista los usuarios sin el hash y las funciones que se pueden activar', async () => {
    const { admin } = await setup();
    const res = await admin.get('/api/v1/admin/users');
    expect(res.status).toBe(200);
    expect(res.body.items.map((u) => u.email)).toEqual(['admin@example.com', 'ana@example.com']);
    expect(res.body.items[1]).toMatchObject({
      role: 'user',
      active: true,
      demo: false,
      features: [],
    });
    expect(JSON.stringify(res.body)).not.toContain('scrypt');
    expect(res.body.features.map((f) => f.id)).toEqual(['experimental-connections']);
  });

  it('da de alta con contraseña generada (una sola vez) y no repite email', async () => {
    const { app, admin } = await setup();
    const res = await admin.post('/api/v1/admin/users', {
      email: 'motra@partner.com',
      name: 'Motra',
      demo: true,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'motra@partner.com', demo: true, role: 'user' });
    expect(res.body.generatedPassword).toMatch(/^.{12}$/);
    expect((await login(app, 'motra@partner.com', res.body.generatedPassword)).status).toBe(200);

    const again = await admin.post('/api/v1/admin/users', {
      email: 'MOTRA@partner.com',
      password: 'otra-contraseña',
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('activa funciones, desactiva (corta la sesión) y vuelve a activar', async () => {
    const { app, admin, ana } = await setup();
    const features = await admin.patch('/api/v1/admin/users/ana', {
      features: ['experimental-connections'],
    });
    expect(features.body.user.features).toEqual(['experimental-connections']);
    expect((await ana.get('/api/v1/connections')).body.items.map((c) => c.id)).toContain('xiaomi');

    const off = await admin.patch('/api/v1/admin/users/ana', { disabled: true });
    expect(off.body.user).toMatchObject({ active: false, disabledAt: expect.any(String) });
    expect((await ana.get('/api/v1/connections')).status).toBe(401);
    const denied = await login(app, 'ana@example.com');
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatchObject({
      code: 'ACCOUNT_INACTIVE',
      message: 'Esta cuenta está desactivada',
    });

    await admin.patch('/api/v1/admin/users/ana', { disabled: false });
    expect((await login(app, 'ana@example.com')).status).toBe(200);
  });

  it('una cuenta caducada no entra', async () => {
    const { app, admin } = await setup();
    await admin.patch('/api/v1/admin/users/ana', { expiresAt: '2020-01-01T00:00:00Z' });
    const res = await login(app, 'ana@example.com');
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('Esta cuenta ha caducado');
  });

  it('cambia la contraseña', async () => {
    const { app, admin } = await setup();
    await admin.patch('/api/v1/admin/users/ana', { password: 'nueva-contraseña' });
    expect((await login(app, 'ana@example.com')).status).toBe(401);
    expect((await login(app, 'ana@example.com', 'nueva-contraseña')).status).toBe(200);
  });

  it('nadie se quita el admin, se desactiva ni se borra a sí mismo', async () => {
    const { admin } = await setup();
    expect((await admin.patch('/api/v1/admin/users/admin', { role: 'user' })).status).toBe(409);
    expect((await admin.patch('/api/v1/admin/users/admin', { disabled: true })).status).toBe(409);
    expect((await admin.delete('/api/v1/admin/users/admin')).status).toBe(409);
    expect((await admin.patch('/api/v1/admin/users/admin', { name: 'Yo' })).status).toBe(200);
  });

  it('borra un usuario', async () => {
    const { admin } = await setup();
    expect((await admin.delete('/api/v1/admin/users/ana')).status).toBe(204);
    expect((await admin.delete('/api/v1/admin/users/ana')).status).toBe(404);
    expect((await admin.patch('/api/v1/admin/users/nadie', { name: 'x' })).status).toBe(404);
  });
});
