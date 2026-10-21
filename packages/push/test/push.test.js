import { describe, it, expect, vi } from 'vitest';
import { createPush, quietUntil, zonedTime, DEFAULT_SETTINGS } from '../src/index.js';

const TZ = 'Europe/Madrid';
const vapid = { publicKey: 'pub', privateKey: 'priv', subject: 'https://dt.example.com' };

/** Misma interfaz que createDbPushStore, en memoria. */
function memoryStore() {
  const subs = new Map();
  const settings = new Map();
  const log = [];
  return {
    subs,
    sent: log,
    saveSubscription: async (userId, { endpoint, keys }, device) =>
      void subs.set(endpoint, { userId, endpoint, keys, device }),
    removeSubscription: async (userId, endpoint) =>
      void (subs.get(endpoint)?.userId === userId && subs.delete(endpoint)),
    dropEndpoint: async (endpoint) => void subs.delete(endpoint),
    subscriptions: async (userId) => [...subs.values()].filter((s) => s.userId === userId),
    touchSubscriptions: async () => {},
    subscribedUsers: async () => [...new Set([...subs.values()].map((s) => s.userId))],
    settings: async (userId) => ({ ...DEFAULT_SETTINGS, ...settings.get(userId) }),
    saveSettings: async (userId, s) => void settings.set(userId, s),
    log: async (userId, n) => {
      if (
        n.dedupeKey &&
        log.some((l) => l.userId === userId && l.kind === n.kind && l.dedupeKey === n.dedupeKey)
      )
        return null;
      log.push({ userId, ...n, at: Date.now() });
      return log.length;
    },
    delivered: async () => {},
    countSince: async (userId) =>
      log.filter((l) => l.userId === userId && l.kind !== 'test').length,
    history: async () => [],
  };
}

// Las 12:00 en Madrid (fuera de las horas de silencio)
const noon = zonedTime({ y: 2026, m: 10, d: 21, h: 12, mi: 0 }, TZ);

function setup({ at = noon } = {}) {
  const store = memoryStore();
  const send = vi.fn(async () => ({ statusCode: 201 }));
  const push = createPush({ store, vapid, timeZone: TZ, send, now: () => at });
  return { store, send, push };
}

const sub = (n) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'k', auth: 'a' } });
const aviso = { kind: 'meals-missing', title: 'Sin comidas', url: '/day', dedupeKey: '2026-10-21' };

describe('push', () => {
  it('manda a todos los dispositivos del usuario, y solo a los suyos', async () => {
    const { push, send } = setup();
    await push.subscribe('ana', sub(1), 'iPhone');
    await push.subscribe('ana', sub(2), 'Mac');
    await push.subscribe('luis', sub(3), 'iPhone');
    expect(await push.notify('ana', aviso)).toEqual({ status: 'sent', delivered: 2 });
    expect(send.mock.calls.map(([s]) => s.endpoint)).toEqual([sub(1).endpoint, sub(2).endpoint]);
    const payload = JSON.parse(send.mock.calls[0][1]);
    expect(payload).toMatchObject({
      title: 'Sin comidas',
      url: '/day',
      tag: 'meals-missing:2026-10-21',
    });
  });

  it('sin dispositivos, apagado por el usuario o repetido: no se manda', async () => {
    const { push, send } = setup();
    expect((await push.notify('ana', aviso)).status).toBe('no-devices');
    await push.subscribe('ana', sub(1));
    await push.updateSettings('ana', { disabled: ['meals-missing', 'no-existe'] });
    expect((await push.settings('ana')).disabled).toEqual(['meals-missing']);
    expect((await push.notify('ana', aviso)).status).toBe('disabled');
    await push.updateSettings('ana', { disabled: [] });
    expect((await push.notify('ana', aviso)).status).toBe('sent');
    expect((await push.notify('ana', aviso)).status).toBe('duplicate');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('máximo diario, sin contar los de prueba', async () => {
    const { push } = setup();
    await push.subscribe('ana', sub(1));
    await push.updateSettings('ana', { maxPerDay: 1 });
    expect((await push.notify('ana', { kind: 'test', title: 'Prueba' })).status).toBe('sent');
    expect((await push.notify('ana', aviso)).status).toBe('sent');
    expect((await push.notify('ana', { ...aviso, dedupeKey: 'otro' })).status).toBe('limit');
    expect((await push.notify('ana', { kind: 'test', title: 'Prueba' })).status).toBe('sent');
  });

  it('en horas de silencio se aplaza hasta que acaben (la prueba sale igual)', async () => {
    const night = zonedTime({ y: 2026, m: 10, d: 21, h: 23, mi: 30 }, TZ);
    const { push } = setup({ at: night });
    await push.subscribe('ana', sub(1));
    const result = await push.notify('ana', aviso);
    expect(result.status).toBe('quiet');
    expect(result.retryAt).toEqual(zonedTime({ y: 2026, m: 10, d: 22, h: 8, mi: 0 }, TZ));
    expect((await push.notify('ana', { kind: 'test', title: 'Prueba' })).status).toBe('sent');
  });

  it('un dispositivo que ya no existe (410) se borra', async () => {
    const { push, store, send } = setup();
    await push.subscribe('ana', sub(1));
    send.mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: 410 }));
    expect(await push.notify('ana', aviso)).toEqual({ status: 'sent', delivered: 0 });
    expect(store.subs.size).toBe(0);
  });
});

describe('quietUntil', () => {
  const s = { quietFrom: '22:00', quietTo: '08:00' };
  const at = (h, mi = 0) => zonedTime({ y: 2026, m: 10, d: 21, h, mi }, TZ);
  it('de madrugada acaba hoy a las 8; por la noche, mañana a las 8; de día, nada', () => {
    expect(quietUntil(at(3), s, TZ)).toEqual(at(8));
    expect(quietUntil(at(22, 30), s, TZ)).toEqual(new Date(at(8).getTime() + 24 * 3600 * 1000));
    expect(quietUntil(at(12), s, TZ)).toBeNull();
    expect(quietUntil(at(12), { quietFrom: '13:00', quietTo: '15:00' }, TZ)).toBeNull();
    expect(quietUntil(at(14), { quietFrom: '13:00', quietTo: '15:00' }, TZ)).toEqual(at(15));
  });
});
