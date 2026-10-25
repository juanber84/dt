import { describe, it, expect, vi } from 'vitest';
import { GoogleHealthSubscribers } from '../src/subscribers.js';

const URL = 'https://dt.example.com/webhooks/google-health';
const TYPES = ['steps', 'sleep'];

/** Cliente falso: responde a list con `existing` y apunta el resto de llamadas. */
function setup(existing) {
  const request = vi.fn(async ({ method = 'GET' }) => ({
    data: method === 'GET' ? { subscribers: existing ? [existing] : [] } : { name: 'nuevo' },
  }));
  const subscribers = new GoogleHealthSubscribers({ projectId: '123', authClient: { request } });
  const writes = () => request.mock.calls.map(([r]) => r).filter((r) => r.method !== 'GET');
  return { subscribers, writes };
}

const options = {
  subscriberId: 'digitaltwin',
  endpointUri: URL,
  secret: 'clave',
  dataTypes: TYPES,
};

const active = {
  name: 'projects/123/subscribers/digitaltwin',
  endpointUri: URL,
  state: 'ACTIVE',
  endpointAuthorization: { secretSet: true },
  subscriberConfigs: [{ dataTypes: ['sleep', 'steps'], subscriptionCreatePolicy: 'AUTOMATIC' }],
};

describe('GoogleHealthSubscribers.ensure', () => {
  it('lo crea si no existe, con el secreto como cabecera Bearer', async () => {
    const { subscribers, writes } = setup(null);
    expect((await subscribers.ensure(options)).action).toBe('created');
    const [create] = writes();
    expect(create.method).toBe('POST');
    expect(create.params).toEqual({ subscriberId: 'digitaltwin' });
    expect(create.data.endpointAuthorization).toEqual({ secret: 'Bearer clave' });
  });

  it('no toca nada si ya está como se pide', async () => {
    const { subscribers, writes } = setup(active);
    expect((await subscribers.ensure(options)).action).toBe('unchanged');
    expect(writes()).toEqual([]);
  });

  it('lo actualiza si cambia la URL o no está activo', async () => {
    for (const drift of [{ endpointUri: 'https://otra' }, { state: 'UNVERIFIED' }]) {
      const { subscribers, writes } = setup({ ...active, ...drift });
      expect((await subscribers.ensure(options)).action).toBe('updated');
      const [patch] = writes();
      expect(patch.method).toBe('PATCH');
      expect(patch.params.updateMask).toBe('endpointUri,endpointAuthorization,subscriberConfigs');
    }
  });

  it('con force lo actualiza aunque cuadre (el secreto no se puede leer)', async () => {
    const { subscribers, writes } = setup(active);
    expect((await subscribers.ensure({ ...options, force: true })).action).toBe('updated');
    expect(writes()).toHaveLength(1);
  });
});

describe('GoogleHealthSubscribers.deliveries', () => {
  it('lee de Cloud Logging los intentos de entrega con su código, página a página', async () => {
    const entry = (at, status) => ({
      timestamp: at,
      resource: { labels: { subscriber_id: 'digitaltwin' } },
      jsonPayload: { httpResponse: { status } },
    });
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: { entries: [entry('2026-10-24T12:09:16Z', 204)], nextPageToken: 'p2' },
      })
      .mockResolvedValueOnce({ data: { entries: [entry('2026-10-24T12:09:17Z', 503)] } });
    const subscribers = new GoogleHealthSubscribers({ projectId: '123', authClient: { request } });

    expect(await subscribers.deliveries({ since: '2026-10-24T00:00:00Z' })).toEqual([
      { at: '2026-10-24T12:09:16Z', status: 204, subscriber: 'digitaltwin' },
      { at: '2026-10-24T12:09:17Z', status: 503, subscriber: 'digitaltwin' },
    ]);
    const [first, second] = request.mock.calls.map(([r]) => r.data);
    expect(first.resourceNames).toEqual(['projects/123']);
    expect(first.filter).toContain('timestamp >= "2026-10-24T00:00:00.000Z"');
    expect(second.pageToken).toBe('p2');
  });
});

describe('GoogleHealthSubscribers.ensureSubscriptions', () => {
  const sub = (id, user, dataTypes) => ({
    name: `projects/123/subscribers/digitaltwin/subscriptions/${id}`,
    user: `users/${user}`,
    dataTypes,
  });

  function withExisting(existing) {
    const request = vi.fn(async ({ method = 'GET' }) => ({
      data: method === 'GET' ? { subscriptions: existing } : {},
    }));
    const subscribers = new GoogleHealthSubscribers({ projectId: '123', authClient: { request } });
    const writes = () =>
      request.mock.calls
        .map(([r]) => r)
        .filter((r) => r.method !== 'GET')
        .map((r) => `${r.method} ${r.url.split('/subscribers/digitaltwin')[1] || '/'}`);
    return { subscribers, writes };
  }

  it('crea las que faltan, corrige tipos, rehace si cambia el usuario y borra las sobrantes', async () => {
    const { subscribers, writes } = withExisting([
      sub('ana', '1', ['steps']),
      sub('luis', '2', ['steps', 'sleep']),
      sub('eva', '3', ['steps']),
      sub('vieja', '9', ['steps']),
    ]);
    const result = await subscribers.ensureSubscriptions('digitaltwin', [
      { subscriptionId: 'ana', healthUserId: '1', dataTypes: ['steps', 'sleep'] },
      { subscriptionId: 'luis', healthUserId: '2', dataTypes: ['sleep', 'steps'] },
      { subscriptionId: 'eva', healthUserId: '33', dataTypes: ['steps'] },
      { subscriptionId: 'nuevo', healthUserId: '4', dataTypes: ['steps'] },
    ]);

    expect(result).toEqual({ created: 1, updated: 2, deleted: 1, unchanged: 1, denied: [] });
    expect(writes()).toEqual([
      'PATCH /subscriptions/ana',
      'DELETE /subscriptions/eva',
      'POST /subscriptions',
      'POST /subscriptions',
      'DELETE /subscriptions/vieja',
    ]);
  });
});

describe('GoogleHealthSubscribers.ensureSubscriptions con permiso denegado', () => {
  it('apunta al usuario que Google niega y sigue con los demás', async () => {
    const request = vi.fn(async ({ method = 'GET', data }) => {
      if (method === 'GET') return { data: { subscriptions: [] } };
      if (data.user === 'users/1')
        throw Object.assign(new Error('denied'), { response: { status: 403, data: {} } });
      return { data: {} };
    });
    const subscribers = new GoogleHealthSubscribers({ projectId: '123', authClient: { request } });
    expect(
      await subscribers.ensureSubscriptions('digitaltwin', [
        { subscriptionId: 'ana', healthUserId: '1', dataTypes: ['steps'] },
        { subscriptionId: 'luis', healthUserId: '2', dataTypes: ['steps'] },
      ]),
    ).toEqual({ created: 1, updated: 0, deleted: 0, unchanged: 0, denied: ['ana'] });
  });

  it('otros errores sí paran (la cola reintenta)', async () => {
    const request = vi.fn(async ({ method = 'GET' }) => {
      if (method === 'GET') return { data: { subscriptions: [] } };
      throw Object.assign(new Error('boom'), { response: { status: 500, data: {} } });
    });
    const subscribers = new GoogleHealthSubscribers({ projectId: '123', authClient: { request } });
    await expect(
      subscribers.ensureSubscriptions('digitaltwin', [
        { subscriptionId: 'ana', healthUserId: '1', dataTypes: ['steps'] },
      ]),
    ).rejects.toThrow();
  });
});
