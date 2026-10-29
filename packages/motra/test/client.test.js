import { describe, expect, it, vi } from 'vitest';
import {
  signInWithPassword,
  createMotraClient,
  MotraErrorCode,
  flattenCalendar,
  buildTemplate,
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

describe('Motra · plantillas', () => {
  const backend = (handler) =>
    vi.fn(async (url, init = {}) =>
      url.includes('securetoken') ? reply(200, { id_token: 'id-1' }) : handler(url, init),
    );

  it('buildTemplate: un bloque por ejercicio, las series en orden y kg por serie', () => {
    const t = buildTemplate({
      userId: 'uid-1',
      name: 'Pierna A',
      caption: 'Fuerza para la bici',
      exercises: [
        {
          exerciseTypeId: 'barbellBackSquat',
          sets: [
            { reps: 5, weightKg: 80, restS: 180 },
            { reps: 5, weightKg: 80 },
          ],
        },
        { exerciseTypeId: 'plank', sets: [{ timeS: 45 }] },
      ],
    });
    expect(t.templateID).toMatch(/^[0-9A-F-]{36}$/);
    expect(t).toMatchObject({ userID: 'uid-1', name: 'Pierna A', accessLevel: 'private' });
    expect(t.activities).toHaveLength(2);
    const [first, second] = t.activities[0].strengthExercise.exercises[0].setIDs.map(
      (id) => t.setMap[id],
    );
    expect(first).toMatchObject({
      exerciseTypeID: 'barbellBackSquat',
      phase: 'main',
      restTime: 180,
      measurements: { reps: 5, weight: { value: 80, unit: 'kg' } },
    });
    expect(second.restTime).toBeUndefined();
    const plank = t.setMap[t.activities[1].strengthExercise.exercises[0].setIDs[0]];
    expect(plank.measurements).toEqual({ time: 45, weight: { value: 0, unit: 'kg' } });
  });

  it('saveTemplate hace PUT por su id con {template, tags}', async () => {
    const fetch = backend(() => reply(200, { success: true }));
    const client = createMotraClient({ refreshToken: 'ref-1', fetch });
    const template = buildTemplate({ userId: 'u', name: 'X', templateId: 'T1', exercises: [] });
    expect(await client.saveTemplate(template)).toBe('T1');
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe('https://backend.motra.com/template/T1');
    expect(init.method).toBe('PUT');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ template, tags: [] });

    await client.saveTemplate(template, { tags: [{ name: 'TwinMe', color: 'orange' }] });
    expect(JSON.parse(fetch.mock.calls[2][1].body).tags).toEqual([
      { name: 'TwinMe', color: 'orange' },
    ]);
  });

  it('una plantilla borrada da NOT_FOUND con el motivo de Motra', async () => {
    const fetch = backend(() =>
      reply(404, { success: false, error: 'Template is deleted', errorCode: 'NOT_FOUND' }),
    );
    const client = createMotraClient({ refreshToken: 'ref-1', fetch });
    await expect(client.deleteTemplate('T1')).rejects.toMatchObject({
      code: MotraErrorCode.NOT_FOUND,
      message: 'Motra 404: Template is deleted',
    });
    expect(fetch.mock.calls[1][1].method).toBe('DELETE');
  });

  it('listTemplates, templateDetails y searchExercises leen su `data`', async () => {
    const fetch = backend((url) => {
      if (url.includes('/my-templates')) return reply(200, { success: true, data: [{ id: 'T1' }] });
      if (url.includes('/details'))
        return reply(200, { success: true, data: { template: { templateID: 'T1' } } });
      return reply(200, { success: true, data: [{ backendKey: 'barbellBenchPress' }] });
    });
    const client = createMotraClient({ refreshToken: 'ref-1', fetch });
    expect(await client.listTemplates()).toEqual([{ id: 'T1' }]);
    expect(await client.templateDetails('T1')).toEqual({ templateID: 'T1' });
    expect(await client.searchExercises({ query: 'press banca', muscleGroups: 'chest' })).toEqual([
      { backendKey: 'barbellBenchPress' },
    ]);
    const searchUrl = new URL(fetch.mock.calls.at(-1)[0]);
    expect(searchUrl.pathname).toBe('/in-workout-search/exercises');
    expect(searchUrl.searchParams.get('query')).toBe('press banca');
    expect(searchUrl.searchParams.get('muscleGroups')).toBe('chest');
  });
});
