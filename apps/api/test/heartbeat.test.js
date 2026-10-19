import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from './helpers.js';
import { createHeartbeats } from '../src/services/heartbeats.js';

const BOT = 'clave-del-bot-0123456789';
const env = { DIGITALTWIN_API_KEYS: `bot:${BOT}` };
const beat = { intervalMs: 60_000, startedAt: '2026-10-15T08:00:00.000Z', username: 'twin_bot' };

describe('latidos', () => {
  it('el bot late con su API key y aparece en readiness', async () => {
    const app = buildApp(env);
    expect((await request(app).get('/api/v1/health/ready')).body.services).toEqual({});

    const res = await request(app)
      .post('/api/v1/heartbeat')
      .set('Authorization', `Bearer ${BOT}`)
      .send(beat);
    expect(res.status).toBe(204);

    const ready = await request(app).get('/api/v1/health/ready');
    expect(ready.body.services.bot).toMatchObject({
      ...beat,
      status: 'ok',
      lastSeenAt: expect.any(String),
    });
  });

  it('exige API key y valida el cuerpo', async () => {
    const app = buildApp(env);
    expect((await request(app).post('/api/v1/heartbeat').send(beat)).status).toBe(401);
    const bad = await request(app)
      .post('/api/v1/heartbeat')
      .set('Authorization', `Bearer ${BOT}`)
      .send({ intervalMs: 'x' });
    expect(bad.status).toBe(400);
  });

  it('lo da por caído tras perder tres latidos', () => {
    let now = Date.parse('2026-10-15T08:00:00Z');
    const heartbeats = createHeartbeats({ now: () => now });
    heartbeats.beat('bot', { intervalMs: 60_000 });
    now += 3 * 60_000;
    expect(heartbeats.snapshot().bot.status).toBe('ok');
    now += 1;
    expect(heartbeats.snapshot().bot).toMatchObject({
      status: 'stale',
      lastSeenAt: '2026-10-15T08:00:00.000Z',
    });
  });
});
