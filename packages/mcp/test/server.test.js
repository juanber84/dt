import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/index.js';

const TZ = 'Europe/Madrid';

/** queries de mentira con la forma de las de @digitaltwin/timeline */
function fakeQueries() {
  return {
    availableMetrics: vi.fn(async () => [
      {
        code: 'body.weight',
        label: 'Peso',
        unit: 'kg',
        aggregation: 'avg',
        first: '2026-09-01T06:00:00.000Z',
        last: '2026-10-16T22:30:00.000Z',
        count: 40,
      },
    ]),
    series: vi.fn(async ({ metrics }) => {
      const all = {
        'body.weight': {
          label: 'Peso',
          unit: 'kg',
          aggregation: 'avg',
          // Los días de Madrid empiezan a las 22:00 UTC en verano
          points: [
            { t: '2026-10-14T22:00:00.000Z', value: 80.4, min: 80.1, max: 80.6, count: 2 },
            { t: '2026-10-15T22:00:00.000Z', value: 80.1, min: 80.1, max: 80.1, count: 1 },
          ],
        },
        'intake.protein': {
          label: 'Proteína',
          unit: 'g',
          aggregation: 'sum',
          points: [{ t: '2026-10-15T22:00:00.000Z', value: 132, count: 3 }],
        },
      };
      return Object.fromEntries(
        Object.entries(all).filter(([code]) => !metrics || metrics.includes(code)),
      );
    }),
    episodes: vi.fn(async () => [
      {
        id: 'e1',
        kind: 'meal',
        start: '2026-10-16T07:00:00.000Z',
        end: null,
        title: 'Tostada',
        summary: { kcal: 250, proteinG: 5 },
        details: { dishes: [{ name: 'Tostada', items: [] }] },
        provider: 'digitaltwin',
      },
    ]),
    observations: vi.fn(async () =>
      Array.from({ length: 600 }, (_, i) => ({
        t: new Date(Date.UTC(2026, 9, 16, 8, 0, i)).toISOString(),
        end: null,
        value: 100 + (i % 20),
        provider: 'google-health',
        origin: 'x',
      })),
    ),
  };
}

async function connect(queries) {
  const server = createMcpServer({
    queries,
    userId: 'user-1',
    timeZone: TZ,
    now: () => new Date('2026-10-16T10:00:00Z'),
  });
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const call = async (client, name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  return { ...res, data: res.isError ? undefined : JSON.parse(res.content[0].text) };
};

describe('servidor MCP', () => {
  let queries;
  let client;

  beforeEach(async () => {
    queries = fakeQueries();
    client = await connect(queries);
  });

  it('ofrece las herramientas de lectura, con instrucciones', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'list_metrics',
      'get_series',
      'get_episodes',
      'get_strength_sets',
      'get_observations',
      'get_day_summary',
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
    expect(client.getInstructions()).toMatch(/list_metrics/);
  });

  it('list_metrics: fechas locales y el día de hoy', async () => {
    const { data } = await call(client, 'list_metrics');
    expect(queries.availableMetrics).toHaveBeenCalledWith('user-1');
    expect(data).toEqual({
      timeZone: TZ,
      today: '2026-10-16',
      metrics: [
        {
          code: 'body.weight',
          label: 'Peso',
          unit: 'kg',
          aggregation: 'avg',
          first: '2026-09-01',
          // 22:30 UTC del 16 ya es día 17 en Madrid
          last: '2026-10-17',
        },
      ],
    });
  });

  it('get_series: días locales → rango UTC, y puntos compactos', async () => {
    const { data } = await call(client, 'get_series', {
      metrics: ['body.weight', 'body.nada'],
      from: '2026-10-15',
      to: '2026-10-16',
    });
    expect(queries.series).toHaveBeenCalledWith({
      userId: 'user-1',
      from: new Date('2026-10-14T22:00:00Z'),
      to: new Date('2026-10-16T22:00:00Z'),
      bucket: 'day',
      metrics: ['body.weight', 'body.nada'],
      timeZone: TZ,
    });
    expect(data.series['body.weight'].points).toEqual([
      { date: '2026-10-15', value: 80.4 },
      { date: '2026-10-16', value: 80.1 },
    ]);
    expect(data.noData).toEqual(['body.nada']);
  });

  it('rangos demasiado grandes o al revés: error para la IA, sin tocar la BD', async () => {
    const hourly = await call(client, 'get_series', {
      metrics: ['heart.rate'],
      from: '2026-10-01',
      to: '2026-10-16',
      bucket: 'hour',
    });
    expect(hourly.isError).toBe(true);
    expect(hourly.content[0].text).toMatch(/7 días/);
    const reversed = await call(client, 'get_episodes', { from: '2026-10-16', to: '2026-10-10' });
    expect(reversed.isError).toBe(true);
    expect(queries.series).not.toHaveBeenCalled();
    expect(queries.episodes).not.toHaveBeenCalled();
  });

  it('get_episodes: sin detalle por defecto, con él si se pide', async () => {
    const plain = await call(client, 'get_episodes', { from: '2026-10-16', to: '2026-10-16' });
    expect(plain.data.episodes).toEqual([
      {
        id: 'e1',
        kind: 'meal',
        start: '2026-10-16 09:00',
        title: 'Tostada',
        summary: { kcal: 250, proteinG: 5 },
        provider: 'digitaltwin',
      },
    ]);
    const full = await call(client, 'get_episodes', {
      from: '2026-10-16',
      to: '2026-10-16',
      details: true,
    });
    expect(full.data.episodes[0].details).toEqual({ dishes: [{ name: 'Tostada', items: [] }] });
  });

  it('get_strength_sets: series en corto, solo los de fuerza y filtro por ejercicio', async () => {
    queries.episodes.mockResolvedValue([
      {
        id: 'w1',
        kind: 'workout',
        start: '2026-10-14T15:17:33.000Z',
        title: 'Pierna',
        schema: 'motra.workout@1',
        details: {
          exercises: [
            {
              name: 'Back Squat',
              primaryMuscleGroups: ['quadriceps'],
              sets: [
                { reps: 8, weightKg: 70, restS: 120 },
                { reps: 10, weightKg: 80, restS: 140 },
              ],
            },
            { name: 'Plank', sets: [{ reps: null, weightKg: null, timeS: 45.2 }] },
          ],
        },
      },
      {
        id: 'b1',
        kind: 'workout',
        start: '2026-10-14T12:16:42.000Z',
        title: 'Bici',
        schema: 'icu.activity@1',
      },
    ]);
    const all = await call(client, 'get_strength_sets', { from: '2026-08-01', to: '2026-10-16' });
    expect(queries.episodes).toHaveBeenCalledWith(expect.objectContaining({ kinds: ['workout'] }));
    expect(all.data.workouts).toEqual([
      {
        start: '2026-10-14 17:17',
        title: 'Pierna',
        exercises: [
          { name: 'Back Squat', muscles: ['quadriceps'], sets: ['8x70', '10x80'], restS: 130 },
          { name: 'Plank', sets: ['45s'] },
        ],
      },
    ]);
    const squat = await call(client, 'get_strength_sets', {
      from: '2026-10-14',
      to: '2026-10-14',
      exercise: 'SQUAT',
    });
    expect(squat.data.workouts[0].exercises.map((x) => x.name)).toEqual(['Back Squat']);
    const tooLong = await call(client, 'get_strength_sets', {
      from: '2026-01-01',
      to: '2026-10-16',
    });
    expect(tooLong.isError).toBe(true);
  });

  it('get_observations: corta en 500 y lo dice', async () => {
    const { data } = await call(client, 'get_observations', {
      metric: 'heart.rate',
      from: '2026-10-16',
      to: '2026-10-16',
    });
    expect(data.points).toHaveLength(500);
    expect(data.truncated).toBe(true);
    expect(data.points[0]).toEqual({
      t: '2026-10-16 10:00',
      value: 100,
      provider: 'google-health',
    });
  });

  it('get_day_summary: hoy por defecto, valor del día de cada métrica y episodios', async () => {
    const { data } = await call(client, 'get_day_summary');
    expect(data).toMatchObject({
      date: '2026-10-16',
      isToday: true,
      metrics: {
        'body.weight': { label: 'Peso', value: 80.4, unit: 'kg' },
        'intake.protein': { label: 'Proteína', value: 132, unit: 'g' },
      },
      episodes: [{ id: 'e1', kind: 'meal' }],
    });
    expect(queries.series.mock.calls[0][0]).toMatchObject({
      from: new Date('2026-10-15T22:00:00Z'),
      to: new Date('2026-10-16T22:00:00Z'),
    });
  });

  it('un fallo de la BD no se le enseña a la IA', async () => {
    queries.availableMetrics.mockRejectedValueOnce(new Error('connection refused 10.0.0.3'));
    const res = await call(client, 'list_metrics');
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe('Error interno al leer los datos');
  });
});
