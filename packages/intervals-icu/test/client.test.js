import { describe, expect, it, vi } from 'vitest';
import { createIntervalsClient, IntervalsErrorCode, isShareable } from '../src/index.js';

const reply = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('intervals.icu', () => {
  it('autenticación básica con API_KEY y el atleta 0', async () => {
    const fetch = vi.fn(async () => reply(200, []));
    await createIntervalsClient({ apiKey: 'secreta', fetch }).activities({
      oldest: '2026-10-01',
      newest: '2026-10-16',
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(
      'https://intervals.icu/api/v1/athlete/0/activities?oldest=2026-10-01&newest=2026-10-16',
    );
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from('API_KEY:secreta').toString('base64')}`,
    );
  });

  it('quita los esqueletos de lo que no se puede compartir', async () => {
    const fetch = async () =>
      reply(200, [
        { id: 'i1', start_date: '2026-10-14T12:15:00Z', type: 'VirtualRide', moving_time: 2400 },
        { id: '123', source: 'STRAVA', _note: 'STRAVA activities are not available via the API' },
      ]);
    const list = await createIntervalsClient({ apiKey: 'k', fetch }).activities({
      oldest: '2026-10-14',
      newest: '2026-10-14',
    });
    expect(list.map((a) => a.id)).toEqual(['i1']);
    expect(isShareable({ id: 'x' })).toBe(false);
  });

  it('errores: clave mala y límite con su espera', async () => {
    const bad = createIntervalsClient({ apiKey: 'k', fetch: async () => reply(401, {}) });
    await expect(bad.athlete()).rejects.toMatchObject({ code: IntervalsErrorCode.INVALID_KEY });
    const busy = createIntervalsClient({
      apiKey: 'k',
      fetch: async () => reply(429, {}, { 'retry-after': '30' }),
    });
    await expect(busy.athlete()).rejects.toMatchObject({
      code: IntervalsErrorCode.RATE_LIMITED,
      retryAfterSeconds: 30,
    });
  });
});
