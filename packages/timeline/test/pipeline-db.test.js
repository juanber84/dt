import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createDb, migrate } from '@digitaltwin/db';
import { createMemoryQueue, JOBS } from '@digitaltwin/queue';
import { createPipeline } from '../src/index.js';

// Necesita una BD de verdad (make test-db). Cada ejecución usa un schema propio que se borra al final.
const url = process.env.TEST_DATABASE_URL;

const apple = (app = 'com.apple.health.X') => ({
  platform: 'HEALTH_KIT',
  application: { packageName: app },
  device: { manufacturer: 'Apple Inc.' },
});
const hr = (time, bpm, source = apple()) => ({
  dataSource: source,
  heartRate: { sampleTime: { physicalTime: time }, beatsPerMinute: String(bpm) },
});
const steps = (start, count, source = apple()) => ({
  dataSource: source,
  steps: {
    interval: { startTime: start, endTime: new Date(Date.parse(start) + 600_000).toISOString() },
    count: String(count),
  },
});
const day = '2026-10-08';
const googleDay = (dataType, points) => ({
  userId: null,
  provider: 'google-health',
  kind: dataType,
  externalId: `${dataType}:${day}`,
  periodStart: `${day}T00:00:00Z`,
  periodEnd: '2026-10-09T00:00:00Z',
  payload: { dataType, from: `${day}T00:00:00Z`, to: '2026-10-09T00:00:00Z', points },
});

describe.skipIf(!url)('pipeline en la BD', () => {
  const schema = `test_${randomBytes(4).toString('hex')}`;
  let admin;
  let db;
  let queue;
  let pipeline;
  let userId;

  beforeAll(async () => {
    admin = createDb(url, { max: 1 });
    await admin.unsafe(`create schema ${schema}`);
    db = createDb(url, { connection: { search_path: `${schema},public` } });
    await migrate(db);
    [{ id: userId }] = await db`
      insert into users (email, password_hash) values ('yo@example.com', 'x') returning id
    `;
    queue = createMemoryQueue();
    pipeline = createPipeline({ db, queue, timeZone: 'Europe/Madrid' });
    await queue.work(JOBS.NORMALIZE, {}, ({ data }) => pipeline.normalize(data.rawId));
  });

  afterAll(async () => {
    await db?.end();
    await admin?.unsafe(`drop schema if exists ${schema} cascade`);
    await admin?.end();
  });

  // El refresco automático de Timescale puede coincidir con el nuestro: se reintenta
  const refresh = async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db`call refresh_continuous_aggregate('observations_hourly', null, null)`;
      } catch (err) {
        if (attempt >= 10 || !/concurrent refresh/.test(err.message)) throw err;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  };

  const ingest = async (record) => {
    const result = await pipeline.ingest({ ...record, userId });
    await queue.drain();
    return result;
  };

  it('ingest + normalize: lo mismo dos veces no cambia nada', async () => {
    const record = googleDay('heart-rate', [
      hr('2026-10-08T10:00:00Z', 60),
      hr('2026-10-08T10:30:00Z', 70),
    ]);
    expect(await ingest(record)).toMatchObject({ changed: true });
    expect(await ingest(record)).toMatchObject({ changed: false });
    const rows = await pipeline.queries.observations({
      userId,
      metric: 'heart.rate',
      from: new Date(`${day}T00:00:00Z`),
      to: new Date('2026-10-09T00:00:00Z'),
    });
    expect(rows.map((r) => r.value)).toEqual([60, 70]);
  });

  it('un día nuevo y vacío no se encola para normalizar', async () => {
    const result = await pipeline.ingest({
      ...googleDay('swim-lengths-data', []),
      userId,
      externalId: 'swim-lengths-data:2026-01-01',
    });
    expect(result).toMatchObject({ changed: true, inserted: true });
    expect(await queue.drain()).toEqual([]);
  });

  it('un día que vuelve a llegar reemplaza el anterior (lo que desaparece se borra)', async () => {
    await ingest(googleDay('heart-rate', [hr('2026-10-08T10:00:00Z', 62)]));
    const rows = await pipeline.queries.observations({
      userId,
      metric: 'heart.rate',
      from: new Date(`${day}T00:00:00Z`),
      to: new Date('2026-10-09T00:00:00Z'),
    });
    expect(rows.map((r) => r.value)).toEqual([62]);
  });

  it('diarios: el día UTC anterior no borra el diario de medianoche local', async () => {
    const daily = (date, bpm) => {
      const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString();
      return {
        userId: null,
        provider: 'google-health',
        kind: 'daily-resting-heart-rate',
        externalId: `daily-resting-heart-rate:${date}`,
        periodStart: `${date}T00:00:00Z`,
        periodEnd: next,
        payload: {
          dataType: 'daily-resting-heart-rate',
          from: `${date}T00:00:00Z`,
          to: next,
          points: [
            {
              dataSource: apple(),
              dailyRestingHeartRate: {
                date: Object.fromEntries(
                  ['year', 'month', 'day'].map((k, i) => [k, Number(date.split('-')[i])]),
                ),
                beatsPerMinute: String(bpm),
              },
            },
          ],
        },
      };
    };
    // El del 21 cae a las 22:00 UTC del 20: normalizar después el 20 no debe borrarlo
    await ingest(daily('2026-11-21', 51));
    await ingest(daily('2026-11-20', 50));
    const rows = await db`
      select o.time, o.value from observations o join metrics m on m.id = o.metric_id
      where o.user_id = ${userId} and m.code = 'heart.resting_rate' order by o.time
    `;
    expect(rows.map((r) => [r.time.toISOString(), r.value])).toEqual([
      ['2026-11-19T23:00:00.000Z', 50],
      ['2026-11-20T23:00:00.000Z', 51],
    ]);
  });

  it('series: por hora elige el stream más completo del proveedor que manda; por día suma', async () => {
    // El reloj y el móvil cuentan los mismos pasos: no se suman
    await ingest(
      googleDay('steps', [
        steps('2026-10-08T10:00:00Z', 100, apple('watch')),
        steps('2026-10-08T10:10:00Z', 100, apple('watch')),
        steps('2026-10-08T10:00:00Z', 150, apple('phone')),
        steps('2026-10-08T15:00:00Z', 50, apple('phone')),
      ]),
    );
    await refresh();
    const from = new Date(`${day}T00:00:00Z`);
    const to = new Date('2026-10-09T00:00:00Z');

    const hourly = await pipeline.queries.series({
      userId,
      from,
      to,
      bucket: 'hour',
      metrics: ['activity.steps'],
    });
    expect(hourly['activity.steps'].points.map((p) => [p.t.slice(11, 13), p.value])).toEqual([
      ['10', 200],
      ['15', 50],
    ]);

    const daily = await pipeline.queries.series({
      userId,
      from,
      to,
      bucket: 'day',
      metrics: ['activity.steps', 'heart.rate'],
      timeZone: 'Europe/Madrid',
    });
    expect(daily['activity.steps'].points).toMatchObject([{ value: 250 }]);
    expect(daily['heart.rate'].points).toMatchObject([{ value: 62 }]);
  });

  it('prioridad entre orígenes: dentro de Google manda el Apple Watch aunque Garmin tenga más', async () => {
    const garmin = {
      platform: 'HEALTH_KIT',
      application: { packageName: 'com.garmin.connect.mobile' },
    };
    await ingest(
      googleDay('heart-rate', [
        hr('2026-10-08T18:05:00Z', 60, apple('com.apple.health')),
        hr('2026-10-08T18:10:00Z', 140, garmin),
        hr('2026-10-08T18:15:00Z', 150, garmin),
      ]),
    );
    await refresh();
    const { 'heart.rate': rate } = await pipeline.queries.series({
      userId,
      from: new Date('2026-10-08T18:00:00Z'),
      to: new Date('2026-10-08T19:00:00Z'),
      bucket: 'hour',
      metrics: ['heart.rate'],
    });
    expect(rate.points).toMatchObject([{ value: 60, count: 1 }]);
  });

  it('prioridad entre proveedores: el peso de Xiaomi manda sobre el que Google copia', async () => {
    const at = '2026-10-08T05:06:18.000Z';
    await ingest({
      provider: 'xiaomi',
      kind: 'scale',
      externalId: 'blt:1',
      periodStart: at,
      periodEnd: new Date(Date.parse(at) + 1).toISOString(),
      payload: {
        did: 'blt',
        model: 'yunmai.scales.ms104',
        createTime: Date.parse(at) / 1000,
        fromSource: 1,
        data: JSON.stringify({ weight: 82.4, bfp: 18.2 }),
      },
    });
    await ingest(
      googleDay('weight', [
        {
          dataSource: { platform: 'HEALTH_KIT', application: { packageName: 'com.xiaomi.mihome' } },
          weight: { sampleTime: { physicalTime: at }, weightGrams: 82300 },
        },
      ]),
    );
    await refresh();
    const series = await pipeline.queries.series({
      userId,
      from: new Date(`${day}T00:00:00Z`),
      to: new Date('2026-10-09T00:00:00Z'),
      bucket: 'hour',
      metrics: ['body.weight'],
    });
    expect(series['body.weight'].points).toMatchObject([{ value: 82.4, provider: 'xiaomi' }]);

    const raw = await pipeline.queries.observations({
      userId,
      metric: 'body.weight',
      from: new Date(`${day}T00:00:00Z`),
      to: new Date('2026-10-09T00:00:00Z'),
    });
    expect(raw.map((r) => [r.provider, r.value]).sort()).toEqual([
      ['google-health', 82.3],
      ['xiaomi', 82.4],
    ]);
  });

  it('comidas: episodios por plato; al corregir, lo que ya no está se borra', async () => {
    const item = {
      name: 'pan',
      quantity: 1,
      unit: 'u',
      kcal: 200,
      proteinG: 7,
      carbsG: 40,
      fatG: 2,
      fiberG: 3,
    };
    const entry = (dishes) => ({
      provider: 'digitaltwin',
      kind: 'meal',
      externalId: 'meal-1',
      periodStart: '2026-10-08T07:00:00Z',
      periodEnd: '2026-10-08T11:00:01Z',
      payload: {
        id: '7a1d1a51-6b0e-4a43-9a3b-1b6bb1e7a001',
        channel: 'telegram',
        text: 'desayuno',
        notes: '',
        dishes,
        createdAt: '2026-10-08T11:00:00Z',
      },
    });
    await ingest(
      entry([
        { name: 'Tostada', eatenAt: '2026-10-08T07:00:00Z', items: [item] },
        { name: 'Bocadillo', eatenAt: '2026-10-08T11:00:00Z', items: [item] },
      ]),
    );
    await ingest(entry([{ name: 'Tostada', eatenAt: '2026-10-08T07:00:00Z', items: [item] }]));

    const episodes = await pipeline.queries.episodes({
      userId,
      from: new Date(`${day}T00:00:00Z`),
      to: new Date('2026-10-09T00:00:00Z'),
      kinds: ['meal'],
    });
    expect(episodes.map((e) => [e.title, e.summary.kcal, e.provider])).toEqual([
      ['Tostada', 200, 'digitaltwin'],
    ]);
    const energy = await pipeline.queries.observations({
      userId,
      metric: 'intake.energy',
      from: new Date(`${day}T00:00:00Z`),
      to: new Date('2026-10-09T00:00:00Z'),
    });
    expect(energy.map((o) => [o.t, o.value])).toEqual([['2026-10-08T07:00:00.000Z', 200]]);
  });

  it('comidas: si el bot tiene comidas ese día, las de Google no salen (salvo canonical: false)', async () => {
    await ingest({
      provider: 'google-health',
      kind: 'nutrition-log',
      externalId: 'nutrition-log:2026-11-10',
      periodStart: '2026-11-10T00:00:00Z',
      periodEnd: '2026-11-11T00:00:00Z',
      payload: {
        dataType: 'nutrition-log',
        from: '2026-11-10T00:00:00Z',
        to: '2026-11-11T00:00:00Z',
        points: [
          {
            name: 'users/1/dataTypes/nutrition-log/dataPoints/1',
            dataSource: apple(),
            nutritionLog: {
              interval: { startTime: '2026-11-10T09:00:00Z', endTime: '2026-11-10T09:01:00Z' },
              foodDisplayName: 'Café',
              energy: { kcal: 36 },
            },
          },
        ],
      },
    });
    const range = {
      userId,
      from: new Date('2026-11-09T00:00:00Z'),
      to: new Date('2026-11-12T00:00:00Z'),
      kinds: ['meal'],
      timeZone: 'Europe/Madrid',
    };
    expect((await pipeline.queries.episodes(range)).map((e) => e.provider)).toEqual([
      'google-health',
    ]);

    await ingest({
      provider: 'digitaltwin',
      kind: 'meal',
      externalId: 'meal-nov',
      periodStart: '2026-11-10T13:00:00Z',
      periodEnd: '2026-11-10T13:00:01Z',
      payload: {
        id: '7a1d1a51-6b0e-4a43-9a3b-1b6bb1e7a002',
        channel: 'telegram',
        text: 'comida',
        notes: '',
        dishes: [
          {
            name: 'Arroz',
            eatenAt: '2026-11-10T13:00:00Z',
            items: [{ name: 'arroz', quantity: 1, unit: 'u', kcal: 300 }],
          },
        ],
        createdAt: '2026-11-10T13:05:00Z',
      },
    });
    expect((await pipeline.queries.episodes(range)).map((e) => e.provider)).toEqual([
      'digitaltwin',
    ]);
    expect(
      (await pipeline.queries.episodes({ ...range, canonical: false })).map((e) => e.provider),
    ).toEqual(['google-health', 'digitaltwin']);
  });

  it('entrenos: la salida de intervals.icu tapa la misma que llega por Google', async () => {
    await ingest({
      provider: 'google-health',
      kind: 'exercise',
      externalId: 'exercise:2026-11-12',
      periodStart: '2026-11-12T00:00:00Z',
      periodEnd: '2026-11-13T00:00:00Z',
      payload: {
        dataType: 'exercise',
        from: '2026-11-12T00:00:00Z',
        to: '2026-11-13T00:00:00Z',
        points: [
          {
            name: 'users/1/dataTypes/exercise/dataPoints/77',
            dataSource: {
              platform: 'HEALTH_KIT',
              application: { packageName: 'com.garmin.connect.mobile' },
            },
            exercise: {
              interval: { startTime: '2026-11-12T16:00:00Z', endTime: '2026-11-12T17:00:00Z' },
              exerciseType: 'BIKING',
              displayName: 'Ciclismo',
            },
          },
        ],
      },
    });
    const range = {
      userId,
      from: new Date('2026-11-12T00:00:00Z'),
      to: new Date('2026-11-13T00:00:00Z'),
      kinds: ['workout'],
    };
    expect((await pipeline.queries.episodes(range)).map((e) => e.provider)).toEqual([
      'google-health',
    ]);
    await ingest({
      provider: 'intervals-icu',
      kind: 'activity',
      externalId: 'i77',
      periodStart: '2026-11-12T16:00:05Z',
      periodEnd: '2026-11-12T17:00:00Z',
      payload: {
        id: 'i77',
        name: 'Salida',
        type: 'Ride',
        source: 'GARMIN_CONNECT',
        start_date: '2026-11-12T16:00:05Z',
        elapsed_time: 3595,
        icu_training_load: 80,
      },
    });
    expect(
      (await pipeline.queries.episodes(range)).map((e) => [e.provider, e.summary.tss]),
    ).toEqual([['intervals-icu', 80]]);
  });

  it('borrado en origen: el registro se queda pero sin datos en el timeline', async () => {
    const rawId = await pipeline.store.markRawDeleted({
      userId,
      provider: 'digitaltwin',
      kind: 'meal',
      externalId: 'meal-1',
    });
    await pipeline.normalize(rawId);
    const episodes = await pipeline.queries.episodes({
      userId,
      from: new Date(`${day}T00:00:00Z`),
      to: new Date('2026-10-09T00:00:00Z'),
      kinds: ['meal'],
    });
    expect(episodes).toEqual([]);
    expect(await pipeline.store.getRaw(rawId)).toMatchObject({ deleted_at: expect.any(Date) });
  });

  it('límite de peticiones compartido', async () => {
    const a = await pipeline.store.hitRateLimit('test', 2, 60);
    const b = await pipeline.store.hitRateLimit('test', 2, 60);
    const c = await pipeline.store.hitRateLimit('test', 2, 60);
    expect([a.allowed, b.allowed, c.allowed]).toEqual([true, true, false]);
    expect(c.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('backfill: progreso hasta terminar', async () => {
    const id = await pipeline.store.startBackfill(userId, 'google-health');
    await pipeline.store.setBackfillTotal(id, 2);
    await pipeline.store.backfillProgress(id);
    expect((await pipeline.store.latestBackfills(userId))['google-health']).toMatchObject({
      status: 'running',
      done: 1,
    });
    await pipeline.store.backfillProgress(id, { failed: true });
    expect((await pipeline.store.latestBackfills(userId))['google-health']).toMatchObject({
      status: 'done',
      done: 1,
      failed: 1,
    });
  });
  it('informe clínico: episodio, valores (con métrica nueva) y el pulso del holter manda', async () => {
    const extraction = {
      type: 'holter',
      title: 'Holter',
      center: null,
      date: '2026-09-30',
      start: '2026-09-30T13:30',
      end: '2026-10-01T12:35',
      summary: 'Ritmo sinusal.',
      items: [
        {
          id: 'i1',
          section: 'Holter',
          name: 'FC media',
          key: 'hr_avg',
          text: '63',
          value: 63,
          unit: 'lpm',
          metric: 'holter.hr_avg',
          metricValue: 63,
          metricUnit: '/min',
          issues: [],
        },
        {
          id: 'i2',
          section: 'Holter',
          name: 'ST máximo',
          key: 'st_max',
          text: '2.1',
          value: 2.1,
          unit: 'mm',
          metric: null,
          metricValue: 2.1,
          metricUnit: 'mm',
          issues: ['unknown'],
        },
      ],
      hourly: [
        {
          start: '2026-09-30T13:30',
          end: '2026-09-30T14:00',
          hrMin: 50,
          hrAvg: 67,
          hrMax: 105,
          verified: true,
        },
      ],
      issues: [],
    };
    // El reloj midió otra cosa en ese tramo: lo del holter manda (prioridad de 'clinical')
    const points = [hr('2026-09-30T11:40:00Z', 80)];
    await ingest({
      provider: 'google-health',
      kind: 'heart-rate',
      externalId: 'heart-rate:2026-09-30',
      periodStart: '2026-09-30T00:00:00Z',
      periodEnd: '2026-10-01T00:00:00Z',
      payload: {
        dataType: 'heart-rate',
        from: '2026-09-30T00:00:00Z',
        to: '2026-10-01T00:00:00Z',
        points,
      },
    });
    const raw = await ingest({
      provider: 'clinical',
      kind: 'document',
      externalId: 'doc-1',
      periodStart: '2026-09-30T11:30:00Z',
      periodEnd: '2026-10-01T10:35:00.001Z',
      payload: { documentId: 'doc-1', fileName: 'holter.pdf', extraction },
    });
    await refresh();

    const [episode] = await pipeline.queries.episodes({
      userId,
      from: new Date('2026-09-30T00:00:00Z'),
      to: new Date('2026-10-01T00:00:00Z'),
      kinds: ['holter'],
    });
    expect(episode).toMatchObject({ kind: 'holter', title: 'Holter', provider: 'clinical' });
    const custom = await pipeline.catalog.get('holter.st_max');
    expect(custom).toMatchObject({ unit: 'mm', aggregation: 'last', label: 'ST máximo' });

    const series = await pipeline.queries.series({
      userId,
      from: new Date('2026-09-30T11:00:00Z'),
      to: new Date('2026-09-30T12:00:00Z'),
      bucket: 'hour',
      metrics: ['heart.rate', 'holter.hr_avg', 'holter.st_max'],
    });
    expect(series['heart.rate'].points).toEqual([
      expect.objectContaining({ value: 67, provider: 'clinical' }),
    ]);
    expect(series['holter.hr_avg'].points[0].value).toBe(63);
    expect(series['holter.st_max'].points[0].value).toBe(2.1);

    // Al borrar el documento no queda nada suyo
    await pipeline.store.markRawDeleted({
      userId,
      provider: 'clinical',
      kind: 'document',
      externalId: 'doc-1',
    });
    await queue.send(JOBS.NORMALIZE, { rawId: raw.id });
    await queue.drain();
    await refresh();
    const after = await pipeline.queries.episodes({
      userId,
      from: new Date('2026-09-30T00:00:00Z'),
      to: new Date('2026-10-01T00:00:00Z'),
      kinds: ['holter'],
    });
    expect(after).toEqual([]);
    const left = await pipeline.queries.series({
      userId,
      from: new Date('2026-09-30T11:00:00Z'),
      to: new Date('2026-09-30T12:00:00Z'),
      bucket: 'hour',
      metrics: ['heart.rate', 'holter.hr_avg'],
    });
    expect(left['heart.rate'].points).toEqual([
      expect.objectContaining({ value: 80, provider: 'google-health' }),
    ]);
    expect(left['holter.hr_avg']).toBeUndefined();
  });
});
