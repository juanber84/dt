import { describe, it, expect, vi } from 'vitest';
import { JOBS } from '@digitaltwin/queue';
import { createJobs } from '../src/jobs.js';
import { createPushRules, messages, withExpiryAlerts } from '../src/notifications.js';

const TZ = 'Europe/Madrid';

describe('avisos', () => {
  it('informe leído: lleva a su día con el informe abierto, uno por informe', () => {
    const n = messages.clinicalReady({ id: 'doc-1' }, { type: 'lab', date: '2026-10-07' });
    expect(n).toMatchObject({
      kind: 'clinical-ready',
      dedupeKey: 'doc-1',
      body: expect.stringMatching(/^Analítica del 7\/10/),
      url: '/day/2026-10-07?event=clinical-doc-1',
    });
  });

  it('conexión caída: avisa solo al pasar a expired, no cada vez que se guarda', async () => {
    const rows = new Map([
      ['u1:google-health', { userId: 'u1', provider: 'google-health', status: 'connected' }],
    ]);
    const store = {
      get: async (userId, provider) => rows.get(`${userId}:${provider}`) ?? null,
      save: async (c) => void rows.set(`${c.userId}:${c.provider}`, c),
    };
    const onExpired = vi.fn();
    const wrapped = withExpiryAlerts(store, onExpired);
    const expired = {
      userId: 'u1',
      provider: 'google-health',
      status: 'expired',
      error: 'Sin permiso',
    };
    await wrapped.save(expired);
    await wrapped.save(expired);
    await wrapped.save({ ...expired, status: 'connected' });
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(messages.connectionExpired(expired, '2026-10-21')).toMatchObject({
      title: 'Google Health se ha desconectado',
      dedupeKey: 'google-health:2026-10-21',
      url: '/admin/connections',
    });
  });

  it('comidas sin apuntar: solo a quien no tiene ninguna hoy y no lo ha apagado', async () => {
    const at = new Date('2026-10-21T14:00:00Z'); // 16:00 en Madrid
    const meals = {
      ana: [{ start: '2026-10-20T19:00:00Z' }], // de ayer
      luis: [{ start: '2026-10-21T07:30:00Z' }], // desayuno de hoy
      eva: [],
    };
    const push = {
      subscribedUsers: async () => ['ana', 'luis', 'eva'],
      settings: async (userId) => ({ disabled: userId === 'eva' ? ['meals-missing'] : [] }),
    };
    const notify = vi.fn();
    const rules = createPushRules({
      push,
      queries: { episodes: async ({ userId }) => meals[userId] },
      notify,
      timeZone: TZ,
      now: () => at,
    });
    expect(await rules.run('meals-missing')).toEqual({ users: 3, notified: 1 });
    expect(notify).toHaveBeenCalledWith(
      'ana',
      expect.objectContaining({ dedupeKey: '2026-10-21' }),
    );
  });

  it('el job push aplaza a después del silencio', async () => {
    const retryAt = new Date('2026-10-22T06:00:00Z');
    const queue = { send: vi.fn() };
    const handler = createJobs({
      queue,
      pipeline: { store: {} },
      connections: {},
      providers: {},
      push: { notify: async () => ({ status: 'quiet', retryAt }) },
      config: {},
      logger: { info() {}, debug() {}, warn() {} },
    }).handlers[JOBS.PUSH];
    const data = { userId: 'ana', notification: { kind: 'meals-missing', title: 'x' } };
    expect((await handler({ data })).status).toBe('quiet');
    expect(queue.send).toHaveBeenCalledWith(JOBS.PUSH, data, { startAfter: retryAt });
  });
});
