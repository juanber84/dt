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
