import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createMemoryPersonalTokens } from '../src/services/personal-tokens.js';
import { buildApp } from './helpers.js';
import { loginCookie, testUsers } from './auth-helpers.js';

// Del timeline solo hacen falta las lecturas
const pipeline = {
  queries: {
    availableMetrics: async (userId) =>
      userId === 'ana'
        ? [
            {
              code: 'body.weight',
              label: 'Peso',
              unit: 'kg',
              aggregation: 'avg',
              first: '2026-10-01T06:00:00.000Z',
              last: '2026-10-16T06:00:00.000Z',
              count: 3,
            },
          ]
        : [],
  },
};

const rpc = (app, token, body) => {
  const req = request(app)
    .post('/api/mcp')
    .set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, ...body });
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

describe('tokens personales y /api/mcp', () => {
  let app;
  let cookie;
  let token;

  beforeAll(async () => {
    app = buildApp(
      {},
      { users: await testUsers(), personalTokens: createMemoryPersonalTokens(), pipeline },
    );
    cookie = await loginCookie(app, 'ana@example.com');
  });

  it('crear un token: sale en claro una vez y luego solo su nombre', async () => {
    const created = await request(app)
      .post('/api/v1/tokens')
      .set('Cookie', cookie)
      .send({ name: 'Claude Code' })
      .expect(201);
    expect(created.body.token).toMatch(/^dt_[\w-]{43}$/);
    token = created.body.token;

    const list = await request(app).get('/api/v1/tokens').set('Cookie', cookie).expect(200);
    expect(list.body.items).toEqual([
      expect.objectContaining({ id: created.body.id, name: 'Claude Code' }),
    ]);
    expect(JSON.stringify(list.body)).not.toContain(token);
  });

  it('los tokens se gestionan con sesión, no con otro token', async () => {
    await request(app)
      .post('/api/v1/tokens')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'otro' })
      .expect(401);
  });

  it('/api/mcp sin token o con uno inventado: 401', async () => {
    const none = await rpc(app, null, { method: 'tools/list' }).expect(401);
    expect(none.headers['www-authenticate']).toMatch(/^Bearer/);
    await rpc(app, 'dt_inventado', { method: 'tools/list' }).expect(401);
  });

  it('con token: initialize, tools/list y tools/call con los datos de SU usuario', async () => {
    const init = await rpc(app, token, {
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      },
    }).expect(200);
    expect(init.body.result.serverInfo.name).toBe('twinme');

    const tools = await rpc(app, token, { method: 'tools/list' }).expect(200);
    expect(tools.body.result.tools.map((t) => t.name)).toContain('get_series');

    const called = await rpc(app, token, {
      method: 'tools/call',
      params: { name: 'list_metrics', arguments: {} },
    }).expect(200);
    const data = JSON.parse(called.body.result.content[0].text);
    expect(data.metrics).toEqual([expect.objectContaining({ code: 'body.weight' })]);
  });

  it('GET /api/mcp: 405 (sin estado, no hay stream)', async () => {
    await request(app).get('/api/mcp').set('Authorization', `Bearer ${token}`).expect(405);
  });

  it('revocar: el token deja de valer', async () => {
    const [{ id }] = (await request(app).get('/api/v1/tokens').set('Cookie', cookie)).body.items;
    await request(app).delete(`/api/v1/tokens/${id}`).set('Cookie', cookie).expect(204);
    await request(app).delete(`/api/v1/tokens/${id}`).set('Cookie', cookie).expect(404);
    await rpc(app, token, { method: 'tools/list' }).expect(401);
  });
});
