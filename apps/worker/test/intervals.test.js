import { describe, expect, it, vi } from 'vitest';
import { createMemoryConnectionStore } from '@digitaltwin/connections';
import { IntervalsError, IntervalsErrorCode } from '@digitaltwin/intervals-icu';
import { createIntervalsProvider } from '../src/providers/intervals.js';
import { RateLimitedError } from '../src/rate-limit.js';

const NOW = Date.parse('2026-10-16T20:00:00Z');
const userId = 'u1';

async function setup(client, connection = {}) {
  const connections = createMemoryConnectionStore();
  await connections.save({
    userId,
    provider: 'intervals-icu',
    status: 'connected',
    credentials: { apiKey: 'k' },
    ...connection,
  });
  const ingest = vi.fn(async () => ({ changed: true }));
  const provider = createIntervalsProvider({
    connections,
    pipeline: { ingest, store: { countRaw: async () => 1 } },
    limiter: { take: async () => {} },
    timeZone: 'Europe/Madrid',
    backfillDays: 10,
    createClient: () => client,
    now: () => NOW,
  });
  return { connections, ingest, provider };
}

describe('proveedor intervals.icu', () => {
  it('trae actividades y wellness y guarda cada uno como raw_record', async () => {
    const client = {
      activities: vi.fn(async () => [
        { id: 'i1', start_date: '2026-10-14T12:15:00Z', type: 'VirtualRide', elapsed_time: 2700 },
      ]),
      wellness: vi.fn(async () => [{ id: '2026-10-14', ctl: 40 }]),
    };
    const { connections, ingest, provider } = await setup(client);
    expect(await provider.sync(userId, { full: true })).toEqual({
      activities: 1,
      wellness: 1,
      changed: 2,
    });
    expect(client.activities).toHaveBeenCalledWith({ oldest: '2026-10-06', newest: '2026-10-16' });
    expect(ingest.mock.calls.map(([r]) => [r.kind, r.externalId])).toEqual([
      ['activity', 'i1'],
      ['wellness', '2026-10-14'],
    ]);
    expect(ingest.mock.calls[1][0].periodStart.toISOString()).toBe('2026-10-13T22:00:00.000Z');
    expect((await connections.get(userId, 'intervals-icu')).lastSync).toBe(
      new Date(NOW).toISOString(),
    );
  });

  it('lo nuevo: desde la última vez con una semana de solape', async () => {
    const client = { activities: vi.fn(async () => []), wellness: vi.fn(async () => []) };
    const { provider } = await setup(client, { lastSync: '2026-10-15T20:00:00Z' });
    await provider.sync(userId);
    expect(client.activities).toHaveBeenCalledWith({ oldest: '2026-10-08', newest: '2026-10-16' });
  });

  it('clave rechazada: la conexión queda caducada; límite: se aplaza', async () => {
    const reject = (code) => async () => {
      throw new IntervalsError(code, 'x', { retryAfterSeconds: 30 });
    };
    const bad = await setup({ activities: reject(IntervalsErrorCode.INVALID_KEY) });
    expect(await bad.provider.sync(userId)).toEqual({ skipped: 'expired' });
    expect((await bad.connections.get(userId, 'intervals-icu')).status).toBe('expired');

    const busy = await setup({ activities: reject(IntervalsErrorCode.RATE_LIMITED) });
    await expect(busy.provider.sync(userId)).rejects.toBeInstanceOf(RateLimitedError);
  });
});
