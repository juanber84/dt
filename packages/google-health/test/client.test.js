import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import nock from 'nock';
import { GoogleHealthClient } from '../src/client.js';
import { GoogleHealthAuth } from '../src/auth.js';

const API = 'https://health.googleapis.com';
const TOKEN = 'https://oauth2.googleapis.com';
const oauth = { clientId: 'cid', clientSecret: 'csecret' };

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());
afterEach(() => nock.cleanAll());

describe('GoogleHealthClient', () => {
  it('refresca el token caducado y avisa para guardarlo', async () => {
    nock(TOKEN)
      .post('/token')
      .reply(200, { access_token: 'NEW', expires_in: 3600, token_type: 'Bearer' });
    nock(API)
      .get('/v4/users/me/identity')
      .matchHeader('authorization', 'Bearer NEW')
      .reply(200, { healthUserId: 'hu-1' });

    const onCredentialsRefreshed = vi.fn();
    const client = new GoogleHealthClient({
      ...oauth,
      credentials: { access_token: 'OLD', refresh_token: 'RT', expiry_date: Date.now() - 1000 },
      onCredentialsRefreshed,
    });

    expect(await client.getIdentity()).toEqual({ healthUserId: 'hu-1' });
    expect(onCredentialsRefreshed).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: 'NEW', refresh_token: 'RT' }),
    );
  });

  it('refresh token inválido -> REAUTH_REQUIRED', async () => {
    nock(TOKEN).post('/token').reply(400, {
      error: 'invalid_grant',
      error_description: 'Token has been expired or revoked.',
    });
    const client = new GoogleHealthClient({
      ...oauth,
      credentials: { refresh_token: 'RT', expiry_date: Date.now() - 1000 },
    });
    await expect(client.getIdentity()).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
  });

  it('403 -> PERMISSION_DENIED', async () => {
    nock(API)
      .get('/v4/users/me/dataTypes/sleep/dataPoints')
      .query(true)
      .reply(403, { error: { message: 'insufficient scopes', status: 'PERMISSION_DENIED' } });
    const client = new GoogleHealthClient({
      ...oauth,
      credentials: { access_token: 'AT', expiry_date: Date.now() + 3600_000 },
    });
    await expect(
      client.request('/users/me/dataTypes/sleep/dataPoints', { params: { filter: 'x' } }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('GoogleHealthAuth', () => {
  const auth = new GoogleHealthAuth({ ...oauth, redirectUri: 'https://app.test/callback' });

  it('getAuthUrl pide acceso offline, consentimiento y state', () => {
    const url = new URL(auth.getAuthUrl({ state: 'abc' }));
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('abc');
    expect(url.searchParams.get('scope')).toContain('googlehealth.ecg.readonly');
  });

  it('exchangeCode devuelve tokens + healthUserId', async () => {
    nock(TOKEN)
      .post('/token', (body) => body.code === 'CODE')
      .reply(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 's' });
    nock(API).get('/v4/users/me/identity').reply(200, { healthUserId: 'hu-9' });

    expect(await auth.exchangeCode('CODE')).toMatchObject({
      access_token: 'AT',
      refresh_token: 'RT',
      healthUserId: 'hu-9',
    });
  });

  it('fromClientSecretJson lee installed o web', () => {
    const a = GoogleHealthAuth.fromClientSecretJson(
      { installed: { client_id: 'x', client_secret: 'y', redirect_uris: ['http://localhost'] } },
      'http://localhost:3000/cb',
    );
    expect(a).toMatchObject({ clientId: 'x', redirectUri: 'http://localhost:3000/cb' });
  });
});

describe('caducidad del permiso', () => {
  it('guarda cuándo caduca el refresh token (modo Prueba de OAuth) como fecha', async () => {
    const { withRefreshExpiry, refreshTokenExpiresAt } = await import('../src/auth.js');
    const now = Date.parse('2026-10-25T21:28:00Z');
    const tokens = withRefreshExpiry({ access_token: 'a', refresh_token_expires_in: 186815 }, now);
    expect(tokens.refresh_token_expires_at).toBe('2026-10-28T01:21:35.000Z');
    expect(refreshTokenExpiresAt(tokens)).toEqual(new Date('2026-10-28T01:21:35.000Z'));
    // Sin caducidad (app publicada), nada
    expect(withRefreshExpiry({ access_token: 'a' })).toEqual({ access_token: 'a' });
    expect(refreshTokenExpiresAt({})).toBeNull();
  });
});
