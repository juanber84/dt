import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from './helpers.js';
import { testUsers, loginCookie } from './auth-helpers.js';
import { createPasskeys } from '../src/services/passkeys.js';

// La firma la hace el dispositivo (Face ID): aquí se finge el resultado de comprobarla
vi.mock('@simplewebauthn/server', async (original) => ({
  ...(await original()),
  verifyRegistrationResponse: vi.fn(async ({ response }) => ({
    verified: response.ok !== false,
    registrationInfo: {
      credential: { id: response.id, publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
      credentialDeviceType: 'multiDevice',
      credentialBackedUp: true,
    },
  })),
  verifyAuthenticationResponse: vi.fn(async ({ response, credential }) => {
    if (response.ok === false) throw new Error('firma no válida');
    return { verified: true, authenticationInfo: { newCounter: credential.counter } };
  }),
}));

/** Passkeys en memoria, con la misma interfaz que las de la BD. */
function memoryStore() {
  const items = new Map();
  return {
    items,
    listByUser: async (userId) => [...items.values()].filter((p) => p.userId === userId),
    get: async (id) => items.get(id) ?? null,
    save: async (p) => void items.set(p.id, { ...p, createdAt: 'x', lastUsedAt: null }),
    used: async (id, counter) => void Object.assign(items.get(id), { counter, lastUsedAt: 'y' }),
    remove: async (userId, id) => items.get(id)?.userId === userId && items.delete(id),
  };
}

/** Solo "nombre=valor" de cada Set-Cookie, para mandarlas juntas. */
const pairs = (res) => (res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]);
const credential = (id, extra = {}) => ({
  id,
  rawId: id,
  type: 'public-key',
  response: {},
  ...extra,
});

let app;
let store;
let session;

beforeAll(async () => {
  store = memoryStore();
  const passkeys = createPasskeys({
    store,
    publicUrl: 'https://dt.example.com',
    secret: 'secreto-de-pruebas-de-32-caracteres!!',
  });
  app = buildApp({}, { users: await testUsers(), passkeys });
  session = (await loginCookie(app)).map((c) => c.split(';')[0]);
});

describe('passkeys (Face ID)', () => {
  it('darla de alta exige sesión', async () => {
    await request(app).post('/api/v1/passkeys/options').expect(401);
  });

  it('alta: reto para el dominio de PUBLIC_URL y se guarda lo que firma el dispositivo', async () => {
    const options = await request(app)
      .post('/api/v1/passkeys/options')
      .set('Cookie', session)
      .expect(200);
    expect(options.body).toMatchObject({
      rp: { id: 'dt.example.com' },
      challenge: expect.any(String),
    });
    expect(options.body.authenticatorSelection).toMatchObject({ userVerification: 'required' });

    await request(app)
      .post('/api/v1/passkeys')
      .set('Cookie', [...session, ...pairs(options)])
      .send({ response: credential('cred-1'), name: 'iPhone' })
      .expect(201);

    const list = await request(app).get('/api/v1/passkeys').set('Cookie', session).expect(200);
    expect(list.body.items).toMatchObject([{ id: 'cred-1', name: 'iPhone', synced: true }]);
  });

  it('sin el reto de antes (caducado o ya gastado) no se da de alta', async () => {
    const res = await request(app)
      .post('/api/v1/passkeys')
      .set('Cookie', session)
      .send({ response: credential('cred-2') })
      .expect(400);
    expect(res.body.error.code).toBe('PASSKEY_NOT_REGISTERED');
  });

  it('entrar con ella: sesión de 30 días sin contraseña', async () => {
    const options = await request(app).post('/api/v1/auth/passkey/options').expect(200);
    expect(options.body.rpId).toBe('dt.example.com');

    const res = await request(app)
      .post('/api/v1/auth/passkey')
      .set('Cookie', pairs(options))
      .send({ response: credential('cred-1') })
      .expect(200);
    expect(res.body.user).toMatchObject({ email: 'admin@example.com' });
    expect(res.headers['set-cookie'].join()).toMatch(/dt_session=ey.*Max-Age=2592000/);
    expect(store.items.get('cred-1').lastUsedAt).toBe('y');
  });

  it('una passkey que no es nuestra, una firma mala o sin reto → 401', async () => {
    for (const response of [credential('otra'), credential('cred-1', { ok: false })]) {
      const options = await request(app).post('/api/v1/auth/passkey/options');
      await request(app)
        .post('/api/v1/auth/passkey')
        .set('Cookie', pairs(options))
        .send({ response })
        .expect(401);
    }
    await request(app)
      .post('/api/v1/auth/passkey')
      .send({ response: credential('cred-1') })
      .expect(401);
  });

  it('cada uno solo borra las suyas', async () => {
    const ana = (await loginCookie(app, 'ana@example.com')).map((c) => c.split(';')[0]);
    await request(app).delete('/api/v1/passkeys/cred-1').set('Cookie', ana).expect(404);
    await request(app).delete('/api/v1/passkeys/cred-1').set('Cookie', session).expect(204);
    expect(store.items.size).toBe(0);
  });
});
