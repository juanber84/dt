import { describe, it, expect, afterEach, vi } from 'vitest';
import nock from 'nock';
import { XiaomiCloudClient } from '../src/client.js';
import { generateSignedNonce, decryptValue, encryptValue } from '../src/crypto.js';

const credentials = {
  userId: '123',
  serviceToken: 'ST',
  ssecurity: Buffer.from('ssecurity-test').toString('base64'),
};

/** Simula Xiaomi: descifra la petición y cifra la respuesta con el mismo nonce. */
function mockApi(path, responseJson, onRequest) {
  let form;
  nock('https://de.api.io.mi.com')
    .post(`/app${path}`, (body) => {
      form = new URLSearchParams(body);
      return true;
    })
    .matchHeader('cookie', /serviceToken=ST/)
    .reply(200, () => {
      const key = generateSignedNonce(
        credentials.ssecurity,
        Buffer.from(form.get('_nonce'), 'base64'),
      );
      onRequest?.(JSON.parse(decryptValue(key, form.get('data'))));
      return encryptValue(key, JSON.stringify(responseJson));
    });
}

afterEach(() => nock.cleanAll());

describe('XiaomiCloudClient', () => {
  it('envía la petición cifrada y descifra la respuesta', async () => {
    let received;
    mockApi('/eco/test', { code: 0, result: [{ ok: true }] }, (payload) => (received = payload));

    const client = new XiaomiCloudClient({ credentials, region: 'de' });
    const result = await client.request('/eco/test', { hello: 'world' });

    expect(received).toEqual({ hello: 'world' });
    expect(result).toEqual([{ ok: true }]);
  });

  it('renueva la sesión al caducar, avisa para guardarla y reintenta', async () => {
    nock('https://de.api.io.mi.com').post('/app/eco/test').reply(401, 'auth err');
    const refreshed = { ...credentials, serviceToken: 'ST', passToken: 'PT2' };
    const auth = { refresh: vi.fn(async () => refreshed) };
    const onCredentialsRefreshed = vi.fn();
    mockApi('/eco/test', { code: 0, result: 'ok' });

    const client = new XiaomiCloudClient({
      credentials: { ...credentials, serviceToken: 'OLD', passToken: 'PT' },
      auth,
      onCredentialsRefreshed,
    });

    expect(await client.request('/eco/test', {})).toBe('ok');
    expect(auth.refresh).toHaveBeenCalledWith(expect.objectContaining({ serviceToken: 'OLD' }));
    expect(onCredentialsRefreshed).toHaveBeenCalledWith(refreshed);
    expect(client.credentials).toBe(refreshed);
  });

  it('lanza SESSION_EXPIRED con HTTP 401 si no se puede renovar', async () => {
    nock('https://de.api.io.mi.com').post('/app/eco/test').reply(401, 'auth err');
    const client = new XiaomiCloudClient({ credentials, autoRefresh: false });
    await expect(client.request('/eco/test', {})).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
  });

  it('lanza API_ERROR si code != 0', async () => {
    mockApi('/eco/test', { code: -8, message: 'bad' });
    const client = new XiaomiCloudClient({ credentials });
    await expect(client.request('/eco/test', {})).rejects.toMatchObject({ code: 'API_ERROR' });
  });

  it('valida credenciales y región', () => {
    expect(() => new XiaomiCloudClient({ credentials: {} })).toThrow(/userId/);
    expect(() => new XiaomiCloudClient({ credentials, region: 'xx' })).toThrow(/Región/);
  });
});
