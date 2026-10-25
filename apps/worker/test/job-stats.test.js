import { describe, it, expect, vi } from 'vitest';
import { JOBS } from '@digitaltwin/queue';
import { createJobs } from '../src/jobs.js';

/** Arranca los consumidores contra una cola falsa y devuelve el del sync, ya envuelto. */
async function startWith(sync) {
  const workers = {};
  const jobs = createJobs({
    queue: {
      send: vi.fn(),
      work: vi.fn(async (name, _opts, fn) => {
        workers[name] = fn;
      }),
      schedule: vi.fn(),
    },
    pipeline: { store: {} },
    connections: {},
    providers: { intervals: { sync } },
    config: {},
    logger: { info() {}, debug() {}, warn() {}, error() {} },
  });
  await jobs.start();
  return { jobs, run: workers[JOBS.SYNC] };
}

describe('contadores del worker', () => {
  it('un intento que pg-boss va a repetir es reintento; solo el último es fallido', async () => {
    const { jobs, run } = await startWith(async () => {
      throw new Error('intervals.icu 503');
    });
    const job = (retryCount) => ({
      id: 'j1',
      data: { provider: 'intervals-icu' },
      retryCount,
      retryLimit: 3,
    });

    for (const n of [0, 1, 2, 3]) await expect(run(job(n))).rejects.toThrow('503');

    const { jobs: counts, lastError } = jobs.stats();
    expect(counts[JOBS.SYNC]).toMatchObject({ failed: 1, retried: 3, done: 0 });
    expect(lastError).toMatchObject({ job: JOBS.SYNC, provider: 'intervals-icu' });
  });
});
