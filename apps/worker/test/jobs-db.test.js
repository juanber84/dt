import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createDb, migrate } from '@digitaltwin/db';
import { createMemoryQueue, JOBS } from '@digitaltwin/queue';
import { createPipeline } from '@digitaltwin/timeline';
import { createMemoryConnectionStore } from '@digitaltwin/connections';
import { GoogleHealthError, GoogleHealthErrorCode, SCOPES } from '@digitaltwin/google-health';
import { createLogger } from '@digitaltwin/logger';
import { loadConfig } from '../src/config/env.js';
import { createRateLimiter } from '../src/rate-limit.js';
import { createXiaomiProvider } from '../src/providers/xiaomi.js';
import { createGoogleProvider } from '../src/providers/google.js';
import { createJobs } from '../src/jobs.js';

// Necesita una BD de verdad (make test-db). Cada ejecución usa un schema propio que se borra al final.
const url = process.env.TEST_DATABASE_URL;
const NOW = Date.parse('2026-10-15T12:00:00Z');

const hr = (time, bpm) => ({
  dataSource: { platform: 'HEALTH_KIT', application: { packageName: 'watch' } },
  heartRate: { sampleTime: { physicalTime: time }, beatsPerMinute: String(bpm) },
});

describe.skipIf(!url)('worker: trabajos', () => {
  const schema = `test_${randomBytes(4).toString('hex')}`;
  const logger = createLogger({ level: 'silent', pretty: false });
  let admin;
  let db;
  let userId;
  let queue;
  let pipeline;
  let connections;
  let listPoints;
  let fetchMeasurements;
  let jobs;
  let perMinute;

  const config = loadConfig({
    DATABASE_URL: 'postgres://x@y/z',
    TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
    GOOGLE_BACKFILL_DAYS: '3',
    GOOGLE_BACKFILL_CHUNK_DAYS: '2',
  });

  beforeAll(async () => {
    admin = createDb(url, { max: 1 });
    await admin.unsafe(`create schema ${schema}`);
    db = createDb(url, { connection: { search_path: `${schema},public` } });
    await migrate(db);
    [{ id: userId }] = await db`
      insert into users (email, password_hash) values ('yo@example.com', 'x') returning id
    `;
  });

  afterAll(async () => {
    await db?.end();
    await admin?.unsafe(`drop schema if exists ${schema} cascade`);
    await admin?.end();
  });

  beforeEach(async () => {
    queue = createMemoryQueue();
    pipeline = createPipeline({ db, queue, timeZone: 'Europe/Madrid' });
    connections = createMemoryConnectionStore();
    perMinute = { 'google-health': 1000, xiaomi: 1000 };
    const limiter = createRateLimiter({ store: pipeline.store, perMinute });
    listPoints = vi.fn(async () => []);
    fetchMeasurements = vi.fn(async () => []);
    jobs = createJobs({
      queue,
      pipeline,
      connections,
      config,
      logger,
      now: () => NOW,
      providers: {
        xiaomi: createXiaomiProvider({
          connections,
          pipeline,
          limiter,
          fetchMeasurements,
          now: () => NOW,
        }),
        google: createGoogleProvider({
          connections,
          pipeline,
          queue,
          limiter,
          oauth: { clientId: 'id', clientSecret: 'secret' },
          timeZone: 'Europe/Madrid',
          listPoints,
          createClient: () => ({}),
        }),
      },
    });
    await jobs.start();
    await connections.save({
      userId,
      provider: 'google-health',
      status: 'connected',
      credentials: { refresh_token: 'r', scope: SCOPES.HEALTH_METRICS },
    });
    await connections.save({ userId, provider: 'xiaomi', status: 'connected', credentials: {} });
  });

  it('backfill de Google: trozos del más reciente al más antiguo, un raw por día y progreso', async () => {
    listPoints.mockImplementation(async (_client, kind, { from }) =>
      kind === 'heart-rate' && from.startsWith('2026-10-14')
        ? [hr('2026-10-14T08:00:00Z', 60), hr('2026-10-15T08:00:00Z', 70)]
        : [],
    );
    await queue.send(JOBS.BACKFILL, { userId, provider: 'google-health' });
    const done = await queue.drain();

    const fetches = done.filter((j) => j.name === JOBS.FETCH);
    const hrFetches = fetches.filter((j) => j.data.kind === 'heart-rate');
    // 3 días de backfill (12, 13, 14 y el 15 en curso) en trozos de 2: [14-16) y [12-14)
    expect(hrFetches.map((j) => [j.data.from.slice(0, 10), j.data.to.slice(0, 10)])).toEqual([
      ['2026-10-14', '2026-10-16'],
      ['2026-10-12', '2026-10-14'],
    ]);
    expect(fetches.every((j) => j.options.priority === 0)).toBe(true);

    const [{ n }] = await db`
      select count(*)::int as n from raw_records where user_id = ${userId} and kind = 'heart-rate'
    `;
    expect(n).toBe(4);
    const rows = await pipeline.queries.observations({
      userId,
      metric: 'heart.rate',
      from: new Date('2026-10-14T00:00:00Z'),
      to: new Date('2026-10-16T00:00:00Z'),
    });
    expect(rows.map((r) => r.value)).toEqual([60, 70]);

    const backfill = (await pipeline.store.latestBackfills(userId))['google-health'];
    expect(backfill).toMatchObject({ status: 'done', failed: 0 });
    expect(backfill.done).toBe(backfill.total);
    expect((await connections.get(userId, 'google-health')).lastSync).toBe(
      new Date(NOW).toISOString(),
    );
  });

  it('sync de Google: desde la última vez con un día de solape, con prioridad alta', async () => {
    await connections.save({
      ...(await connections.get(userId, 'google-health')),
      lastSync: '2026-10-15T06:00:00.000Z',
    });
    await queue.send(JOBS.SYNC, { userId, provider: 'google-health' });
    const done = await queue.drain();
    const fetches = done.filter((j) => j.name === JOBS.FETCH && j.data.kind === 'heart-rate');
    // Un trabajo por día (lo más reciente primero): hoy y ayer
    expect(fetches.map((j) => [j.data.from.slice(0, 10), j.options.priority])).toEqual([
      ['2026-10-15', 10],
      ['2026-10-14', 10],
    ]);
  });

  it('Google retira el permiso: la conexión queda para reconectar y el backfill se para', async () => {
    listPoints.mockRejectedValue(new GoogleHealthError(GoogleHealthErrorCode.REAUTH_REQUIRED, 'x'));
    await queue.send(JOBS.BACKFILL, { userId, provider: 'google-health' });
    const done = await queue.drain();
    expect((await connections.get(userId, 'google-health')).status).toBe('expired');
    expect((await pipeline.store.latestBackfills(userId))['google-health'].status).toBe(
      'cancelled',
    );
    // Tras el primero, el resto de trozos ni se intentan
    expect(listPoints).toHaveBeenCalledTimes(1);
    expect(done.filter((j) => j.name === JOBS.FETCH).length).toBeGreaterThan(1);
  });

  it('límite de peticiones: el trabajo se aplaza en vez de fallar', async () => {
    perMinute['google-health'] = 0.5; // ninguna petición permitida en esta ventana
    await queue.send(JOBS.FETCH, {
      userId,
      provider: 'google-health',
      kind: 'heart-rate',
      from: '2026-10-15T00:00:00.000Z',
      to: '2026-10-16T00:00:00.000Z',
      priority: 10,
    });
    await queue.drain({ limit: 1 });
    expect(listPoints).not.toHaveBeenCalled();
    expect(queue.jobs).toMatchObject([
      { name: JOBS.FETCH, options: { startAfter: expect.any(Number), priority: 10 } },
    ]);
  });

  it('Xiaomi: el backfill trae todo y el cron encola un sync por conexión', async () => {
    fetchMeasurements.mockResolvedValue([
      {
        id: 'blt:1',
        timestamp: Date.parse('2026-10-13T05:06:18Z'),
        weight: 82.4,
        bodyFat: 18.2,
        raw: {
          did: 'blt',
          model: 'yunmai.scales.ms104',
          createTime: Date.parse('2026-10-13T05:06:18Z') / 1000,
          fromSource: 1,
          data: JSON.stringify({ weight: 82.4, bfp: 18.2 }),
        },
      },
    ]);
    await queue.send(JOBS.BACKFILL, { userId, provider: 'xiaomi' });
    await queue.drain();
    expect(fetchMeasurements).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ from: undefined }),
    );
    expect(await connections.get(userId, 'xiaomi')).toMatchObject({
      lastSync: new Date(NOW).toISOString(),
      records: 1,
      lastRecord: { weight: 82.4, bodyFat: 18.2 },
    });
    const episodes = await pipeline.queries.episodes({
      userId,
      from: new Date('2026-10-13T00:00:00Z'),
      to: new Date('2026-10-14T00:00:00Z'),
      kinds: ['weigh-in'],
    });
    expect(episodes).toMatchObject([{ provider: 'xiaomi', summary: { weight: 82.4 } }]);

    await queue.send(JOBS.SCHEDULED_SYNC, { provider: 'xiaomi' });
    const done = await queue.drain();
    expect(done.filter((j) => j.name === JOBS.SYNC).map((j) => j.data.userId)).toEqual([userId]);
    expect(fetchMeasurements).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ from: new Date(NOW - 14 * 24 * 3600 * 1000) }),
    );
  });
});
