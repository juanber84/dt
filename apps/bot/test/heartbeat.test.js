import { describe, it, expect, vi, afterEach } from 'vitest';
import { startHeartbeat } from '../src/heartbeat.js';

afterEach(() => vi.useRealTimers());

const logger = () => ({ info: vi.fn(), warn: vi.fn() });

describe('startHeartbeat', () => {
  it('late al arrancar y luego cada intervalo, con la info y el intervalo', async () => {
    vi.useFakeTimers();
    const api = { heartbeat: vi.fn().mockResolvedValue(null) };
    const stop = startHeartbeat({ api, info: { username: 'twin_bot' }, intervalMs: 1000 });
    expect(api.heartbeat).toHaveBeenCalledTimes(1);
    expect(api.heartbeat.mock.calls[0][0]).toMatchObject({
      username: 'twin_bot',
      intervalMs: 1000,
      startedAt: expect.any(String),
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.heartbeat).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.heartbeat).toHaveBeenCalledTimes(3);
  });

  it('no late si el bot no está vivo', async () => {
    vi.useFakeTimers();
    const api = { heartbeat: vi.fn().mockResolvedValue(null) };
    const stop = startHeartbeat({ api, intervalMs: 1000, isAlive: () => false });
    await vi.advanceTimersByTimeAsync(3000);
    expect(api.heartbeat).not.toHaveBeenCalled();
    stop();
  });

  it('avisa una sola vez mientras la API falla y otra cuando vuelve', async () => {
    vi.useFakeTimers();
    const log = logger();
    const api = {
      heartbeat: vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue(null),
    };
    const stop = startHeartbeat({ api, intervalMs: 1000, logger: log });
    await vi.advanceTimersByTimeAsync(2000);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledTimes(1);
    stop();
  });
});
