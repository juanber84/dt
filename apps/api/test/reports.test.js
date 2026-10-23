import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { EmailError, EmailErrorCode } from '@digitaltwin/email';
import { buildApp } from './helpers.js';
import { testUsers, loginCookie } from './auth-helpers.js';

const REPORT = {
  id: '0b6c1f3e-9a4b-4d2a-8f1e-2c3d4e5f6a7b',
  kind: 'daily',
  title: 'Tu día: jueves 22 de octubre',
  periodFrom: '2026-10-22',
  periodTo: '2026-10-22',
  createdAt: '2026-10-23T05:30:00.000Z',
  blocks: [{ type: 'text', text: 'Ayer bien.' }],
};

let app;
let reports;
let ana;

beforeAll(async () => {
  let settings = { dailyEnabled: true, dailyTime: '07:30' };
  reports = {
    store: {
      list: vi.fn(async () => [{ ...REPORT, blocks: undefined }]),
      get: vi.fn(async (_userId, id) => (id === REPORT.id ? REPORT : null)),
      settings: vi.fn(async () => settings),
      saveSettings: vi.fn(async (_userId, next) => {
        settings = next;
      }),
    },
    daily: vi.fn(async () => REPORT),
    sendDaily: vi.fn(async () => ({ status: 'sent', id: 'em_1' })),
  };
  app = buildApp({}, { users: await testUsers(), reports });
  ana = await loginCookie(app, 'ana@example.com');
});

describe('/api/v1/reports', () => {
  it('sin sesión no hay nada', async () => {
    await request(app).get('/api/v1/reports').expect(401);
    await request(app).post('/api/v1/reports/daily').expect(401);
  });

  it('lista y abre los suyos (los de otro, 404)', async () => {
    const list = await request(app).get('/api/v1/reports').set('Cookie', ana).expect(200);
    expect(list.body.items).toHaveLength(1);
    const one = await request(app)
      .get(`/api/v1/reports/${REPORT.id}`)
      .set('Cookie', ana)
      .expect(200);
    expect(one.body.blocks).toEqual(REPORT.blocks);
    const userId = reports.store.get.mock.calls.at(-1)[0];
    expect(reports.store.list.mock.calls.at(-1)[0]).toBe(userId);
    await request(app)
      .get('/api/v1/reports/1f2e3d4c-5b6a-4789-8abc-def012345678')
      .set('Cookie', ana)
      .expect(404);
    await request(app).get('/api/v1/reports/no-es-un-id').set('Cookie', ana).expect(400);
  });

  it('preferencias: se guardan por partes y se valida la hora', async () => {
    const res = await request(app)
      .put('/api/v1/reports/settings')
      .set('Cookie', ana)
      .send({ dailyTime: '09:00' })
      .expect(200);
    expect(res.body).toEqual({ dailyEnabled: true, dailyTime: '09:00' });
    await request(app)
      .put('/api/v1/reports/settings')
      .set('Cookie', ana)
      .send({ dailyTime: '25:00' })
      .expect(400);
  });

  it('el de ayer ahora: lo hace y lo manda a su correo aunque ya saliera', async () => {
    const res = await request(app).post('/api/v1/reports/daily').set('Cookie', ana).expect(201);
    expect(res.body).toEqual({
      id: REPORT.id,
      title: REPORT.title,
      email: { status: 'sent', id: 'em_1' },
    });
    expect(reports.sendDaily).toHaveBeenCalledWith(REPORT, {
      userId: expect.any(String),
      to: 'ana@example.com',
      force: true,
    });
  });

  it('si el correo falla, el informe queda hecho y se dice por qué', async () => {
    reports.sendDaily.mockRejectedValueOnce(
      new EmailError(EmailErrorCode.REJECTED, 'Resend 403: domain not verified'),
    );
    const res = await request(app).post('/api/v1/reports/daily').set('Cookie', ana).expect(201);
    expect(res.body.email).toEqual({ status: 'failed', error: 'Resend 403: domain not verified' });
  });
});
