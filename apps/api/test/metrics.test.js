import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createMemoryQueue } from '@digitaltwin/queue';
import { buildApp } from './helpers.js';
import { createHeartbeats } from '../src/services/heartbeats.js';
import { createMetrics } from '../src/services/metrics.js';

const NOW = Date.parse('2026-10-24T12:00:00Z');

/** Valor de una serie en el texto de Prometheus (o undefined si no está). */
function value(text, series) {
  const line = text.split('\n').find((l) => l.startsWith(`${series} `));
  return line === undefined ? undefined : Number(line.slice(series.length + 1));
}

function fakePipeline({ worker, backups = [] } = {}) {
  return {
    store: {
      workerHeartbeats: async () => (worker ? [worker] : []),
      recentBackups: async () => backups,
    },
  };
}

const worker = (jobs, startedAt = '2026-10-24T08:00:00.000Z') => ({
  startedAt,
  lastSeenAt: new Date(NOW - 10_000).toISOString(),
  intervalMs: 30_000,
  status: 'ok',
  stats: { jobs },
});

async function scrape(metrics) {
  const res = { headers: {}, set: (k, v) => (res.headers[k] = v), send: (b) => (res.body = b) };
  await metrics.handler({}, res);
  return res.body;
}

describe('/metrics', () => {
  it('se sirve en la raíz, fuera de /api, y mide las peticiones por plantilla de ruta', async () => {
    const app = buildApp();
    await request(app).get('/api/v1/health/ready');
    await request(app).get('/api/v1/no-existe');
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain(
      'digitaltwin_http_request_duration_seconds_count{method="GET",route="/api/v1/health/ready",status="200"} 1',
    );
    // Sin sesión, lo que no existe da 401 antes del 404: cuenta como ruta sin casar
    expect(res.text).toMatch(/route="unmatched",status="401"/);
    expect(res.text).toContain('digitaltwin_api_process_resident_memory_bytes');
  });

  it('publica colas, latidos y la última copia', async () => {
    const queue = createMemoryQueue();
    await queue.send('sync', {});
    let clock = NOW - 5 * 60_000;
    const heartbeats = createHeartbeats({ now: () => clock });
    heartbeats.beat('bot', { intervalMs: 60_000 });
    clock = NOW;
    const metrics = createMetrics({
      heartbeats,
      queue,
      now: () => NOW,
      pipeline: fakePipeline({
        worker: worker({ sync: { done: 3, failed: 1, postponed: 0 } }),
        backups: [
          { status: 'running', finishedAt: null },
          { status: 'ok', finishedAt: '2026-10-24T02:00:10.000Z', sizeBytes: 9_000_000 },
        ],
      }),
    });

    const text = await scrape(metrics);
    expect(value(text, 'digitaltwin_queue_jobs{queue="sync",state="ready"}')).toBe(1);
    expect(value(text, 'digitaltwin_service_up{service="worker"}')).toBe(1);
    expect(value(text, 'digitaltwin_service_last_seen_seconds{service="worker"}')).toBe(10);
    // El bot latió hace 5 min con intervalo de 1 min: lo da por caído
    expect(value(text, 'digitaltwin_service_up{service="bot"}')).toBe(0);
    expect(value(text, 'digitaltwin_worker_jobs_total{queue="sync",result="done"}')).toBe(3);
    expect(value(text, 'digitaltwin_worker_jobs_total{queue="sync",result="failed"}')).toBe(1);
    expect(value(text, 'digitaltwin_backup_last_success_timestamp_seconds')).toBe(
      Date.parse('2026-10-24T02:00:10Z') / 1000,
    );
    expect(value(text, 'digitaltwin_backup_last_size_bytes')).toBe(9_000_000);
    // La que está en marcha no cuenta como fallo
    expect(value(text, 'digitaltwin_backup_last_failed')).toBe(0);
  });

  it('los contadores del worker suben con él y empiezan de cero si se reinicia', async () => {
    let current = worker({ fetch: { done: 5, failed: 0, postponed: 0 } });
    const pipeline = {
      store: { ...fakePipeline().store, workerHeartbeats: async () => [current] },
    };
    const metrics = createMetrics({ pipeline, now: () => NOW });
    const done = 'digitaltwin_worker_jobs_total{queue="fetch",result="done"}';

    expect(value(await scrape(metrics), done)).toBe(5);
    current = worker({ fetch: { done: 8, failed: 0, postponed: 0 } });
    expect(value(await scrape(metrics), done)).toBe(8);
    current = worker({ fetch: { done: 2, failed: 0, postponed: 0 } }, '2026-10-24T11:00:00.000Z');
    expect(value(await scrape(metrics), done)).toBe(2);
  });

  it('sin latido del worker en el último día lo da por caído, y una copia fallida se ve', async () => {
    const metrics = createMetrics({
      now: () => NOW,
      pipeline: fakePipeline({
        backups: [{ status: 'error', finishedAt: '2026-10-24T02:00:00.000Z' }],
      }),
    });
    const text = await scrape(metrics);
    expect(value(text, 'digitaltwin_service_up{service="worker"}')).toBe(0);
    expect(value(text, 'digitaltwin_backup_last_failed')).toBe(1);
  });
});
