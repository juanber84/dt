import { describe, expect, it, vi } from 'vitest';
import {
  signInWithPassword,
  createMotraClient,
  MotraErrorCode,
  flattenCalendar,
} from '../src/index.js';

const reply = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('Motra · login', () => {
  it('signInWithPassword devuelve refresh token y la cuenta', async () => {
    const fetch = vi.fn(async () =>
      reply(200, { idToken: 'id-1', refreshToken: 'ref-1', localId: 'uid-1', email: 'yo@x.com' }),
    );
    const session = await signInWithPassword({
      email: 'yo@x.com',
      password: 'secreta',
      apiKey: 'k',
      fetch,
    });
    expect(session).toEqual({
      refreshToken: 'ref-1',
      idToken: 'id-1',
      accountId: 'uid-1',
      email: 'yo@x.com',
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toContain('/accounts:signInWithPassword?key=k');
    expect(JSON.parse(init.body)).toMatchObject({ email: 'yo@x.com', password: 'secreta' });
  });

  it('email o contraseña mal → INVALID_CREDENTIALS', async () => {
    const fetch = async () => reply(400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } });
    await expect(
      signInWithPassword({ email: 'a@b.c', password: 'mala', apiKey: 'k', fetch }),
    ).rejects.toMatchObject({ code: MotraErrorCode.INVALID_CREDENTIALS });
  });

  it('límite de Firebase → RATE_LIMITED con su espera', async () => {
    const fetch = async () => reply(429, {}, { 'retry-after': '30' });
    await expect(
      signInWithPassword({ email: 'a@b.c', password: 'p', apiKey: 'k', fetch }),
    ).rejects.toMatchObject({
      code: MotraErrorCode.RATE_LIMITED,
      retryAfterSeconds: 30,
    });
  });
});

describe('Motra · lecturas', () => {
  it('saca un idToken con el refresh token y lo lleva como Bearer', async () => {
    const fetch = vi.fn(async (url) => {
      if (url.includes('securetoken')) return reply(200, { id_token: 'id-xyz' });
      return reply(200, { success: true, data: {} });
    });
    const client = createMotraClient({ refreshToken: 'ref-1', apiKey: 'k', fetch });
    await client.calendarWorkouts({ startMs: 1_000_000, endMs: 2_000_000 });

    const [tokenUrl, tokenInit] = fetch.mock.calls[0];
    expect(tokenUrl).toContain('/token?key=k');
    expect(tokenInit.body).toContain('grant_type=refresh_token');
    const [getUrl, getInit] = fetch.mock.calls[1];
    expect(getUrl).toBe(
      'https://backend.motra.com/user/calendar-workouts/v3?startTimestamp=1000&endTimestamp=2000',
    );
    expect(getInit.headers.Authorization).toBe('Bearer id-xyz');
  });

  it('si Firebase rota el refresh token, avisa para guardarlo', async () => {
    const onRefreshToken = vi.fn();
    const fetch = async (url) =>
      url.includes('securetoken')
        ? reply(200, { id_token: 'id-1', refresh_token: 'ref-2' })
        : reply(200, { success: true, data: { workout: { workoutID: 'W1' } } });
    const client = createMotraClient({ refreshToken: 'ref-1', onRefreshToken, fetch });
    expect(await client.workoutDetails('W1')).toEqual({ workoutID: 'W1' });
    expect(onRefreshToken).toHaveBeenCalledWith('ref-2');
  });

  it('refresh token muerto (contraseña cambiada) → SESSION_EXPIRED', async () => {
    const fetch = async () => reply(400, { error: { message: 'TOKEN_EXPIRED' } });
    const client = createMotraClient({ refreshToken: 'viejo', fetch });
    await expect(client.calendarWorkouts({ startMs: 0, endMs: 1 })).rejects.toMatchObject({
      code: MotraErrorCode.SESSION_EXPIRED,
    });
  });

  it('si el idToken caduca (401), renueva una vez y reintenta', async () => {
    let gets = 0;
    const fetch = vi.fn(async (url) => {
      if (url.includes('securetoken')) return reply(200, { id_token: `id-${gets}` });
      gets++;
      return gets === 1
        ? reply(401, {})
        : reply(200, { success: true, data: { workout: { id: 1 } } });
    });
    const client = createMotraClient({ refreshToken: 'ref-1', apiKey: 'k', fetch });
    expect(await client.workoutDetails('W1')).toEqual({ id: 1 });
    expect(fetch.mock.calls.filter(([u]) => u.includes('securetoken'))).toHaveLength(2);
  });

  it('flattenCalendar junta los días, quita repetidos y ordena por inicio', () => {
    const calendar = {
      '2026-10-14': [{ workoutID: 'b', timeStarted: 200 }],
      '2026-10-09': [
        { workoutID: 'a', timeStarted: 100 },
        { workoutID: 'b', timeStarted: 200 },
      ],
    };
    expect(flattenCalendar(calendar).map((w) => w.workoutID)).toEqual(['a', 'b']);
    expect(flattenCalendar(null)).toEqual([]);
  });
});
