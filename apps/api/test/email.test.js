import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { EmailError, EmailErrorCode } from '@digitaltwin/email';
import { buildApp } from './helpers.js';
import { testUsers, loginCookie } from './auth-helpers.js';

let app;
let email;
let ana;

beforeAll(async () => {
  email = {
    history: vi.fn(async () => []),
    send: vi.fn(async () => ({ status: 'sent', id: 'em_1' })),
  };
  app = buildApp({ PUBLIC_URL: 'https://twinme.app' }, { users: await testUsers(), email });
  ana = await loginCookie(app, 'ana@example.com');
});

describe('/api/v1/email', () => {
  it('sin sesión no hay nada', async () => {
    await request(app).get('/api/v1/email').expect(401);
    await request(app).post('/api/v1/email/test').expect(401);
  });

  it('a qué correo llegan y el historial, del usuario de la sesión', async () => {
    const res = await request(app).get('/api/v1/email').set('Cookie', ana).expect(200);
    expect(res.body).toEqual({ to: 'ana@example.com', history: [] });
    expect(email.history).toHaveBeenCalledWith(expect.any(String), 10);
  });

  it('el de prueba va a su propio correo, con enlace a la app', async () => {
    const res = await request(app).post('/api/v1/email/test').set('Cookie', ana).expect(200);
    expect(res.body).toEqual({ status: 'sent', id: 'em_1' });
    const [, sent] = email.send.mock.calls.at(-1);
    expect(sent).toMatchObject({ kind: 'test', to: 'ana@example.com' });
    expect(sent.html).toContain('https://twinme.app/day');
    expect(sent.text).toContain('https://twinme.app/day');
  });

  it('si Resend no lo manda, 502 con el motivo', async () => {
    email.send.mockRejectedValueOnce(
      new EmailError(EmailErrorCode.REJECTED, 'Resend 403: domain not verified'),
    );
    const res = await request(app).post('/api/v1/email/test').set('Cookie', ana).expect(502);
    expect(res.body.error).toMatchObject({ code: 'EMAIL_FAILED' });
    expect(res.body.error.message).toContain('domain not verified');
  });

  it('sin Resend configurado no existe', async () => {
    const plain = buildApp({}, { users: await testUsers() });
    const cookie = await loginCookie(plain, 'ana@example.com');
    await request(plain).get('/api/v1/email').set('Cookie', cookie).expect(404);
  });
});
