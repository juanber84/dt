import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { createDb, migrate } from '@digitaltwin/db';
import { createMemoryQueue, JOBS } from '@digitaltwin/queue';
import { createPipeline } from '@digitaltwin/timeline';
import { createMemoryConnectionStore } from '@digitaltwin/connections';
import { createTestKeyset } from '@digitaltwin/google-health/testing';
import { IntervalsError, IntervalsErrorCode } from '@digitaltwin/intervals-icu';
import { createDbUserStore } from '../src/services/users-db.js';
import { signBody, SIGNATURE_HEADER } from '../src/routes/digitaltwin-webhook.routes.js';
import { buildApp } from './helpers.js';
import { PASSWORD, loginCookie } from './auth-helpers.js';

// Necesita una BD de verdad (make test-db). Cada ejecución usa un schema propio que se borra al final.
const url = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = 'w'.repeat(40);
const GOOGLE_SECRET = 'Bearer secreto-de-pruebas-largo';
const TELEGRAM_ID = 4242;
const { keyset, sign } = createTestKeyset();
// intervals.icu de mentira: solo vale una clave
const intervalsClient = (apiKey) => ({
  athlete: async () => {
    if (apiKey !== 'clave-buena-123') {
      throw new IntervalsError(IntervalsErrorCode.INVALID_KEY, 'no');
    }
    return { id: 'i123', name: 'Juan' };
  },
});

const meal = {
  id: '7a1d1a51-6b0e-4a43-9a3b-1b6bb1e7a001',
  source: 'telegram',
  text: 'tostada con aceite',
  notes: '',
  dishes: [
    {
      name: 'Tostada',
      eatenAt: '2026-10-15T07:00:00.000Z',
      items: [
        {
          name: 'pan',
          quantity: 60,
          unit: 'g',
          kcal: 160,
          proteinG: 5,
          carbsG: 30,
          fatG: 1,
          fiberG: 2,
        },
        {
          name: 'aceite',
          quantity: 10,
          unit: 'ml',
          kcal: 90,
          proteinG: 0,
          carbsG: 0,
          fatG: 10,
          fiberG: 0,
        },
      ],
    },
  ],
  createdAt: '2026-10-15T07:05:00.000Z',
};

describe.skipIf(!url)('API con el pipeline (BD + cola)', () => {
  const schema = `test_${randomBytes(4).toString('hex')}`;
  let admin;
  let db;
  let app;
  let queue;
  let pipeline;
  let connections;
  let me;
  let cookie;

  const webhook = (event, secret = WEBHOOK_SECRET) => {
    const body = JSON.stringify(event);
    return request(app)
      .post('/webhooks/digitaltwin')
      .set('Content-Type', 'application/json')
      .set(SIGNATURE_HEADER, signBody(body, secret))
      .send(body);
  };

  beforeAll(async () => {
    admin = createDb(url, { max: 1 });
    await admin.unsafe(`create schema ${schema}`);
    db = createDb(url, { connection: { search_path: `${schema},public` } });
    await migrate(db);
    const users = createDbUserStore({ db });
    ({ user: me } = await users.upsert({
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
      password: PASSWORD,
    }));
    queue = createMemoryQueue();
    pipeline = createPipeline({ db, queue, timeZone: 'Europe/Madrid' });
    await queue.work(JOBS.NORMALIZE, {}, ({ data }) => pipeline.normalize(data.rawId));
    connections = createMemoryConnectionStore();
    await connections.save({
      userId: me.id,
      provider: 'telegram',
      status: 'connected',
      externalUserId: String(TELEGRAM_ID),
    });
    app = buildApp(
      { DIGITALTWIN_WEBHOOK_SECRET: WEBHOOK_SECRET, GOOGLE_HEALTH_WEBHOOK_SECRET: GOOGLE_SECRET },
      { db, users, queue, pipeline, connections, googleHealthWebhook: { keyset }, intervalsClient },
    );
    cookie = await loginCookie(app);
  });

  afterAll(async () => {
    await db?.end();
    await admin?.unsafe(`drop schema if exists ${schema} cascade`);
    await admin?.end();
  });

  it('la comida del bot entra por el webhook firmado y sale en el timeline', async () => {
    const res = await webhook({ type: 'meal.logged', telegramUserId: TELEGRAM_ID, data: meal });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'routed', changed: true });
    // Reenviar lo mismo (el bot reintenta) no duplica
    expect(
      (await webhook({ type: 'meal.logged', telegramUserId: TELEGRAM_ID, data: meal })).body,
    ).toMatchObject({ changed: false });
    await queue.drain();

    const episodes = await request(app)
      .get('/api/v1/timeline/episodes')
      .query({ from: '2026-10-15T00:00:00Z', to: '2026-10-16T00:00:00Z' })
      .set('Cookie', cookie);
    expect(episodes.status).toBe(200);
    expect(episodes.body.items).toMatchObject([
      {
        kind: 'meal',
        title: 'Tostada',
        provider: 'digitaltwin',
        summary: { kcal: 250, fatG: 11 },
        details: { text: 'tostada con aceite', items: [{ name: 'pan' }, { name: 'aceite' }] },
      },
    ]);

    await db`call refresh_continuous_aggregate('observations_hourly', null, null)`.catch(() => {});
    const series = await request(app)
      .get('/api/v1/timeline/series')
      .query({
        from: '2026-10-15T00:00:00Z',
        to: '2026-10-16T00:00:00Z',
        metrics: 'intake.energy,intake.protein',
      })
      .set('Cookie', cookie);
    expect(series.body.series['intake.energy'].points).toMatchObject([{ value: 250 }]);
    expect(series.body.series['intake.protein'].points).toMatchObject([{ value: 5 }]);

    const [inbox] = await db`select * from inbox where type = 'meal.logged' order by id limit 1`;
    expect(inbox).toMatchObject({ kind: 'data', status: 'routed', user_id: me.id });
  });

  it('webhook: firma mala, evento raro o Telegram sin vincular', async () => {
    const event = { type: 'meal.logged', telegramUserId: TELEGRAM_ID, data: meal };
    expect((await webhook(event, 'x'.repeat(40))).status).toBe(401);
    expect((await webhook({ type: 'otra.cosa', telegramUserId: 1 })).status).toBe(400);
    const res = await webhook({ ...event, telegramUserId: 999 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('TELEGRAM_NOT_LINKED');
  });

  it('el bot pide sincronizar: se encola un sync', async () => {
    queue.jobs.length = 0;
    const res = await webhook({
      type: 'sync.requested',
      telegramUserId: TELEGRAM_ID,
      data: { provider: 'xiaomi' },
    });
    expect(res.status).toBe(202);
    expect(queue.jobs).toMatchObject([
      { name: JOBS.SYNC, data: { userId: me.id, provider: 'xiaomi', reason: 'telegram' } },
    ]);
  });

  it('aviso de Google: se descarga el día entero del tipo que ha cambiado', async () => {
    queue.jobs.length = 0;
    await connections.save({
      userId: me.id,
      provider: 'google-health',
      status: 'connected',
      externalUserId: 'hu-1',
      credentials: { refresh_token: 'r' },
    });
    const body = JSON.stringify([
      {
        data: {
          healthUserId: 'hu-1',
          dataType: 'steps',
          operation: 'UPSERT',
          intervals: [
            {
              physicalTimeInterval: {
                startTime: '2026-10-15T08:00:00Z',
                endTime: '2026-10-15T08:10:00Z',
              },
            },
          ],
        },
      },
    ]);
    await request(app)
      .post('/webhooks/google-health')
      .set('Authorization', GOOGLE_SECRET)
      .set('Content-Type', 'application/json')
      .set('GOOGLE-HEALTH-API-SIGNATURE', sign(body))
      .send(body)
      .expect(204);
    await vi.waitFor(() => expect(queue.jobs).toHaveLength(1));
    expect(queue.jobs[0]).toMatchObject({
      name: JOBS.FETCH,
      data: {
        userId: me.id,
        kind: 'steps',
        from: '2026-10-15T00:00:00.000Z',
        to: '2026-10-16T00:00:00.000Z',
      },
    });
  });

  it('sincronizar desde la web se encola (202) y el progreso del backfill sale en la lista', async () => {
    queue.jobs.length = 0;
    await connections.save({
      userId: me.id,
      provider: 'xiaomi',
      status: 'connected',
      credentials: {},
    });
    const res = await request(app).post('/api/v1/connections/xiaomi/sync').set('Cookie', cookie);
    expect(res.status).toBe(202);
    expect(queue.jobs).toMatchObject([{ name: JOBS.SYNC, data: { provider: 'xiaomi' } }]);

    const id = await pipeline.store.startBackfill(me.id, 'xiaomi');
    await pipeline.store.setBackfillTotal(id, 4);
    const list = await request(app).get('/api/v1/connections').set('Cookie', cookie);
    expect(list.body.items.find((c) => c.id === 'xiaomi').backfill).toMatchObject({
      status: 'running',
      total: 4,
      done: 0,
    });
  });

  it('intervals.icu: la clave se comprueba, se guarda y se encola la carga inicial', async () => {
    queue.jobs.length = 0;
    const bad = await request(app)
      .post('/api/v1/connections/intervals-icu/connect')
      .set('Cookie', cookie)
      .send({ apiKey: 'clave-mala-000' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_KEY');

    const ok = await request(app)
      .post('/api/v1/connections/intervals-icu/connect')
      .set('Cookie', cookie)
      .send({ apiKey: 'clave-buena-123' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'connected', account: 'Juan' });
    expect(JSON.stringify(ok.body)).not.toContain('clave-buena-123');
    expect(queue.jobs).toMatchObject([
      { name: JOBS.BACKFILL, data: { provider: 'intervals-icu' } },
    ]);
    expect((await connections.get(me.id, 'intervals-icu')).credentials).toEqual({
      apiKey: 'clave-buena-123',
    });
    const list = await request(app).get('/api/v1/connections').set('Cookie', cookie);
    expect(list.body.items.find((c) => c.id === 'intervals-icu')).toMatchObject({
      available: true,
      status: 'connected',
    });
  });

  it('Sistema: el latido del worker y lo que hay en cada cola salen en /health/ready', async () => {
    expect((await request(app).get('/api/v1/health/ready')).body.services.worker).toBeUndefined();

    await pipeline.store.workerBeat({
      workerId: 'vps:1',
      hostname: 'vps',
      version: '0.1.0',
      startedAt: '2026-10-15T08:00:00Z',
      intervalMs: 30_000,
      stats: { jobs: { normalize: { done: 3, failed: 1, postponed: 0 } }, lastError: null },
    });
    queue.jobs.length = 0;
    await queue.send(JOBS.FETCH, { userId: me.id, provider: 'google-health' });

    const res = await request(app).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.services.worker).toMatchObject({
      status: 'ok',
      hostname: 'vps',
      instances: 1,
      stats: { jobs: { normalize: { done: 3, failed: 1 } } },
    });
    expect(res.body.queues.fetch).toEqual({ ready: 1, deferred: 0, active: 0, failed: 0 });

    // Sin latir más de tres intervalos: caído
    await db`update worker_heartbeats set last_seen_at = now() - interval '2 minutes'`;
    expect((await request(app).get('/api/v1/health/ready')).body.services.worker.status).toBe(
      'stale',
    );
  });

  it('vincular Telegram: código en la web, el bot lo confirma, y queda vinculado (una sola vez)', async () => {
    const start = await request(app)
      .post('/api/v1/connections/telegram/link')
      .set('Cookie', cookie);
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ code: expect.stringMatching(/^[A-Z2-9]{8}$/), url: null });
    expect(start.body.command).toBe(`/vincular ${start.body.code}`);

    // Otra cuenta de Telegram, con el código en minúsculas
    const res = await webhook({
      type: 'account.link',
      telegramUserId: 5555,
      data: { code: start.body.code.toLowerCase(), username: 'yo' },
    });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ linked: true, email: 'admin@example.com' });

    const list = await request(app).get('/api/v1/connections').set('Cookie', cookie);
    expect(list.body.telegram).toMatchObject({
      available: true,
      status: 'connected',
      account: '@yo',
      externalUserId: '5555',
    });
    // Ahora las comidas de esa cuenta son de este usuario; la anterior (4242) ya no
    expect(
      (
        await webhook({
          type: 'sync.requested',
          telegramUserId: 5555,
          data: { provider: 'xiaomi' },
        })
      ).status,
    ).toBe(202);
    expect(
      (
        await webhook({
          type: 'sync.requested',
          telegramUserId: TELEGRAM_ID,
          data: { provider: 'xiaomi' },
        })
      ).status,
    ).toBe(422);

    // El código no se puede reutilizar
    const again = await webhook({
      type: 'account.link',
      telegramUserId: 6666,
      data: { code: start.body.code },
    });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('LINK_CODE_INVALID');

    expect(
      (await request(app).delete('/api/v1/connections/telegram').set('Cookie', cookie)).status,
    ).toBe(204);
    const after = await request(app).get('/api/v1/connections').set('Cookie', cookie);
    expect(after.body.telegram.status).toBe('disconnected');
  });

  it('con el latido del bot, el enlace abre el bot con el código puesto', async () => {
    const beat = buildApp(
      { DIGITALTWIN_WEBHOOK_SECRET: WEBHOOK_SECRET, DIGITALTWIN_API_KEYS: `bot:${'k'.repeat(20)}` },
      { db, users: createDbUserStore({ db }), queue, pipeline, connections },
    );
    await request(beat)
      .post('/api/v1/heartbeat')
      .set('Authorization', `Bearer ${'k'.repeat(20)}`)
      .send({ intervalMs: 60_000, startedAt: new Date().toISOString(), username: 'twin_bot' })
      .expect(204);
    const res = await request(beat)
      .post('/api/v1/connections/telegram/link')
      .set('Cookie', await loginCookie(beat));
    expect(res.body.url).toBe(`https://t.me/twin_bot?start=link-${res.body.code}`);
  });
  it('MCP: con un token personal, la IA ve las comidas del bot en su día local', async () => {
    const { body } = await request(app)
      .post('/api/v1/tokens')
      .set('Cookie', cookie)
      .send({ name: 'Claude Code' })
      .expect(201);
    const res = await request(app)
      .post('/api/mcp')
      .set('Authorization', `Bearer ${body.token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'get_episodes',
          arguments: { from: '2026-10-15', to: '2026-10-15', kinds: ['meal'] },
        },
      })
      .expect(200);
    const data = JSON.parse(res.body.result.content[0].text);
    expect(data.episodes).toMatchObject([
      { kind: 'meal', title: 'Tostada', start: '2026-10-15 09:00' },
    ]);
    const [token] = await db`select last_used_at from personal_tokens where id = ${body.id}`;
    expect(token.last_used_at).toBeInstanceOf(Date);
  });

  it('Sistema: el admin ve lo que ha llegado (sin payload) y el historial de la cola', async () => {
    const res = await request(app)
      .get('/api/v1/admin/system/activity?limit=5')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.inbox.length).toBeGreaterThan(0);
    expect(res.body.inbox[0]).toMatchObject({
      provider: expect.any(String),
      status: expect.any(String),
    });
    expect(res.body.inbox[0]).not.toHaveProperty('payload');
    expect(Array.isArray(res.body.jobs)).toBe(true);
    expect(res.body.counts).toBeTypeOf('object');
    await request(app)
      .get('/api/v1/admin/system/activity?name=DROP')
      .set('Cookie', cookie)
      .expect(400);
  });

  it('Registrar: agua, síntoma y peso entran en el timeline y se pueden borrar', async () => {
    const post = (body) =>
      request(app).post('/api/v1/entries').set('Cookie', cookie).send(body).expect(201);
    const water = await post({ kind: 'water', at: '2026-10-21T10:00:00+02:00', value: 500 });
    await post({ kind: 'water', at: '2026-10-21T13:00:00+02:00', value: 250 });
    await post({ kind: 'symptom', at: '2026-10-21T09:00:00+02:00', text: 'Mocos', value: 3 });
    await post({ kind: 'weight', at: '2026-10-21T08:00:00+02:00', value: 82.4 });
    await request(app)
      .post('/api/v1/entries')
      .set('Cookie', cookie)
      .send({ kind: 'symptom', at: '2026-10-21T09:00:00+02:00', text: '' })
      .expect(400);

    const range = { from: '2026-10-20T22:00:00Z', to: '2026-10-21T22:00:00Z' };
    const episodes = async () =>
      (
        await request(app)
          .get('/api/v1/timeline/episodes')
          .query({ ...range, kinds: 'drink,symptom,weigh-in' })
          .set('Cookie', cookie)
          .expect(200)
      ).body.items;
    expect((await episodes()).map((e) => [e.kind, e.title])).toEqual([
      ['weigh-in', '82.4 kg'],
      ['symptom', 'Mocos'],
      ['drink', 'Agua'],
      ['drink', 'Agua'],
    ]);
    for (let attempt = 0; ; attempt++) {
      try {
        await db`call refresh_continuous_aggregate('observations_hourly', null, null)`;
        break;
      } catch (err) {
        if (attempt >= 10 || !/concurrent refresh/.test(err.message)) throw err;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    const series = await request(app)
      .get('/api/v1/timeline/series')
      .query({ ...range, bucket: 'day', metrics: 'intake.water', tz: 'Europe/Madrid' })
      .set('Cookie', cookie)
      .expect(200);
    expect(series.body.series['intake.water'].points.map((p) => p.value)).toEqual([750]);

    for (const at of ['2026-10-20T22:00:00+02:00', '2026-10-21T06:00:00+02:00']) {
      await post({ kind: 'medication', at, text: 'Enantyum', dose: '1 comprimido' });
    }
    await post({ kind: 'medication', at: '2026-10-21T10:00:00+02:00', text: 'Anginovag' });
    const meds = await request(app)
      .get('/api/v1/entries/medications')
      .set('Cookie', cookie)
      .expect(200);
    expect(meds.body.items).toEqual(['Enantyum', 'Anginovag']);

    await request(app).delete(`/api/v1/entries/${water.body.id}`).set('Cookie', cookie).expect(204);
    await request(app).delete(`/api/v1/entries/${water.body.id}`).set('Cookie', cookie).expect(404);
    expect((await episodes()).filter((e) => e.kind === 'drink')).toHaveLength(1);
  });
});
