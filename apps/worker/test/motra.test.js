import { describe, expect, it, vi } from 'vitest';
import { createMemoryConnectionStore } from '@digitaltwin/connections';
import { MotraError, MotraErrorCode } from '@digitaltwin/motra';
import { createMotraProvider } from '../src/providers/motra.js';
import { RateLimitedError } from '../src/rate-limit.js';

const NOW = Date.parse('2026-10-16T20:00:00Z');
const DAY_MS = 24 * 3600 * 1000;
const userId = 'u1';

async function setup(client, connection = {}) {
  const connections = createMemoryConnectionStore();
  await connections.save({
    userId,
    provider: 'motra',
    status: 'connected',
    credentials: { refreshToken: 'ref-1' },
    ...connection,
  });
  const ingest = vi.fn(async () => ({ changed: true }));
  const createClient = vi.fn((options) => {
    client.options = options;
    return client;
  });
  const provider = createMotraProvider({
    connections,
    pipeline: { ingest, store: { countRaw: async () => 1 } },
    limiter: { take: async () => {} },
    backfillDays: 10,
    createClient,
    now: () => NOW,
  });
  return { connections, ingest, provider, createClient };
}

describe('proveedor Motra', () => {
  it('índice → detalle de cada entreno, con el tipo del índice, como raw_record', async () => {
    const client = {
      calendarWorkouts: vi.fn(async () => ({
        '2026-10-14': [
          {
            workoutID: 'W1',
            timeStarted: 1791991053,
            timeEnded: 1791995184,
            activityType: 'traditionalStrengthTraining',
            workoutFormat: 'trainStrength',
          },
        ],
      })),
      workoutDetails: vi.fn(async (id) => ({
        workoutID: id,
        name: 'Pierna',
        timeStarted: 1791991053.6,
        timeEnded: 1791995184.2,
        setMap: {},
      })),
    };
    const { connections, ingest, provider, createClient } = await setup(client);
    expect(await provider.sync(userId, { full: true })).toEqual({ workouts: 1, changed: 1 });

    expect(createClient.mock.calls[0][0].refreshToken).toBe('ref-1');
    expect(client.calendarWorkouts).toHaveBeenCalledWith({
      startMs: NOW - 10 * DAY_MS,
      endMs: NOW,
    });
    const [record] = ingest.mock.calls[0];
    expect(record).toMatchObject({
      provider: 'motra',
      kind: 'workout',
      externalId: 'W1',
      periodStart: 1791991053600,
      periodEnd: 1791995184200,
    });
    // El tipo solo viene en el índice: se copia al payload
    expect(record.payload).toMatchObject({
      activityType: 'traditionalStrengthTraining',
      workoutFormat: 'trainStrength',
    });
    expect((await connections.get(userId, 'motra')).lastSync).toBe(new Date(NOW).toISOString());
  });

  it('lo nuevo: desde la última vez con una semana de solape', async () => {
    const client = { calendarWorkouts: vi.fn(async () => ({})), workoutDetails: vi.fn() };
    const { provider } = await setup(client, { lastSync: '2026-10-15T20:00:00Z' });
    await provider.sync(userId);
    expect(client.calendarWorkouts).toHaveBeenCalledWith({
      startMs: Date.parse('2026-10-08T20:00:00Z'),
      endMs: NOW,
    });
  });

  it('si Firebase rota el refresh token, se guarda el nuevo', async () => {
    const client = { calendarWorkouts: vi.fn(async () => ({})), workoutDetails: vi.fn() };
    const { connections, provider } = await setup(client);
    await provider.sync(userId);
    await client.options.onRefreshToken('ref-2');
    expect((await connections.get(userId, 'motra')).credentials).toEqual({ refreshToken: 'ref-2' });
  });

  it('sesión caducada: la conexión queda para reconectar; límite: se aplaza', async () => {
    const reject = (code) => async () => {
      throw new MotraError(code, 'x', { retryAfterSeconds: 30 });
    };
    const dead = await setup({ calendarWorkouts: reject(MotraErrorCode.SESSION_EXPIRED) });
    expect(await dead.provider.sync(userId)).toEqual({ skipped: 'expired' });
    expect((await dead.connections.get(userId, 'motra')).status).toBe('expired');

    const busy = await setup({ calendarWorkouts: reject(MotraErrorCode.RATE_LIMITED) });
    await expect(busy.provider.sync(userId)).rejects.toBeInstanceOf(RateLimitedError);
  });
});
