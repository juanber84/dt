import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from './helpers.js';
import { loginCookie, testUsers } from './auth-helpers.js';

const KEY = 'a'.repeat(64);
const pipeline = { queries: { availableMetrics: async () => [] } };

/** LLM de la app de mentira: cada respuesta "cuesta" 0,322 $ (1M de entrada y 100k de salida). */
const appLlm = () => ({
  model: 'deepseek-flash',
  complete: vi.fn(async () => ({
    message: { role: 'assistant', content: 'Vale.' },
    usage: { prompt_tokens: 1_000_000, completion_tokens: 100_000 },
    model: 'deepseek-flash',
  })),
});

const ask = (app, cookie) =>
  request(app).post('/api/v1/coach/messages').set('Cookie', cookie).send({ text: 'hola' });

/**
 * Los proveedores, de mentira: `reply(call)` contesta cada llamada; `calls` guarda URL, cabecera y
 * body. (supertest va por http, no por fetch.)
 */
const provider = { calls: [], reply: () => Response.json({}) };
beforeAll(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      const call = { url, auth: init.headers.Authorization, body: JSON.parse(init.body) };
      provider.calls.push(call);
      return provider.reply(call);
    }),
  ),
);
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  provider.calls = [];
});

const accepts = () => Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });

describe('límite de IA al día', () => {
  let app;
  let llm;
  let ana;
  let admin;

  beforeAll(async () => {
    llm = appLlm();
    app = buildApp(
      { TOKEN_ENCRYPTION_KEY: KEY },
      { users: await testUsers(), pipeline, coachLlm: llm },
    );
    ana = await loginCookie(app, 'ana@example.com');
    admin = await loginCookie(app, 'admin@example.com');
  });

  it('Cuenta → IA: límite por defecto, nada gastado y la lista de proveedores', async () => {
    const res = await request(app).get('/api/v1/ai').set('Cookie', ana).expect(200);
    expect(res.body).toMatchObject({ limitUsd: 0.25, spentTodayUsd: 0, own: null });
    expect(res.body.providers.map((p) => p.id)).toEqual([
      'deepseek',
      'openai',
      'openrouter',
      'groq',
      'mistral',
      'gemini',
    ]);
    // Los administradores no tienen límite
    const mine = await request(app).get('/api/v1/ai').set('Cookie', admin).expect(200);
    expect(mine.body.limitUsd).toBeNull();
  });

  it('pasado el límite, el coach contesta 429 sin llamar al modelo', async () => {
    await ask(app, ana).expect(200);
    expect(llm.complete).toHaveBeenCalledTimes(1);

    const res = await ask(app, ana).expect(429);
    expect(res.body.error).toMatchObject({
      code: 'AI_LIMIT',
      details: { limitUsd: 0.25, spentUsd: expect.closeTo(0.322, 6) },
    });
    expect(llm.complete).toHaveBeenCalledTimes(1);

    // También las comidas y subir un informe (lo lee el LLM)
    const meal = await request(app)
      .post('/api/v1/nutrition/analyze')
      .set('Cookie', ana)
      .send({ text: 'avena' })
      .expect(429);
    expect(meal.body.error.code).toBe('AI_LIMIT');
  });

  it('el admin no tiene límite', async () => {
    await ask(app, admin).expect(200);
    await ask(app, admin).expect(200);
  });

  it('en Usuarios se le sube el límite a una persona', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/users/ana')
      .set('Cookie', admin)
      .send({ aiDailyLimitUsd: 5 })
      .expect(200);
    expect(res.body.user.aiDailyLimitUsd).toBe(5);
    const list = await request(app).get('/api/v1/admin/users').set('Cookie', admin).expect(200);
    expect(list.body.aiDailyLimitUsd).toBe(0.25);

    await ask(app, ana).expect(200);
    const status = await request(app).get('/api/v1/ai').set('Cookie', ana).expect(200);
    expect(status.body.limitUsd).toBe(5);
    expect(status.body.spentTodayUsd).toBeCloseTo(2 * 0.322, 6);

    // null: vuelve al de por defecto
    await request(app)
      .patch('/api/v1/admin/users/ana')
      .set('Cookie', admin)
      .send({ aiDailyLimitUsd: null })
      .expect(200);
    await ask(app, ana).expect(429);
  });
});

describe('clave propia', () => {
  let app;
  let llm;
  let ana;

  beforeAll(async () => {
    llm = appLlm();
    app = buildApp(
      { TOKEN_ENCRYPTION_KEY: KEY },
      { users: await testUsers(), pipeline, coachLlm: llm },
    );
    ana = await loginCookie(app, 'ana@example.com');
  });

  it('una clave que el proveedor rechaza no se guarda', async () => {
    provider.reply = () =>
      Response.json({ error: { message: 'Incorrect API key provided' } }, { status: 401 });
    const res = await request(app)
      .put('/api/v1/ai/provider')
      .set('Cookie', ana)
      .send({ provider: 'openai', model: 'gpt-4.1-mini', apiKey: 'sk-mala' })
      .expect(400);
    expect(res.body.error).toMatchObject({
      code: 'PROVIDER_TEST_FAILED',
      message: 'Clave no válida (Incorrect API key provided)',
    });
    const status = await request(app).get('/api/v1/ai').set('Cookie', ana).expect(200);
    expect(status.body.own).toBeNull();
  });

  it('solo proveedores de la lista', async () => {
    await request(app)
      .put('/api/v1/ai/provider')
      .set('Cookie', ana)
      .send({ provider: 'http://169.254.169.254', model: 'x', apiKey: 'k' })
      .expect(400);
  });

  it('la prueba y la guarda; nunca la devuelve, solo los 4 últimos', async () => {
    provider.reply = accepts;
    const res = await request(app)
      .put('/api/v1/ai/provider')
      .set('Cookie', ana)
      .send({ provider: 'openai', model: 'gpt-4.1-mini', apiKey: 'sk-buena-1234' })
      .expect(200);
    // Lo que pide la app: modo JSON (macros, informes) y herramientas (coach)
    expect(provider.calls).toEqual([
      expect.objectContaining({
        url: 'https://api.openai.com/v1/chat/completions',
        auth: 'Bearer sk-buena-1234',
        body: expect.objectContaining({ response_format: { type: 'json_object' } }),
      }),
      expect.objectContaining({ body: expect.objectContaining({ tools: expect.any(Array) }) }),
    ]);
    // El thinking es solo de DeepSeek
    expect(provider.calls[0].body.thinking).toBeUndefined();
    expect(res.body.own).toMatchObject({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      keyHint: '…1234',
    });
    expect(JSON.stringify(res.body)).not.toContain('sk-buena');
  });

  it('con su clave el coach va por su proveedor, sin límite y sin contar para él', async () => {
    const sse = [
      { choices: [{ delta: { content: 'Hola' } }], model: 'gpt-4.1-mini' },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 5_000_000, completion_tokens: 10 } },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join('');
    provider.reply = () =>
      new Response(`${sse}data: [DONE]\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' },
      });

    await ask(app, ana).expect(200);
    await ask(app, ana).expect(200);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]).toMatchObject({
      url: 'https://api.openai.com/v1/chat/completions',
      auth: 'Bearer sk-buena-1234',
      body: { model: 'gpt-4.1-mini', stream: true },
    });
    expect(llm.complete).not.toHaveBeenCalled();
    const status = await request(app).get('/api/v1/ai').set('Cookie', ana).expect(200);
    expect(status.body.spentTodayUsd).toBe(0);
  });

  it('cambiar solo el modelo reutiliza la clave guardada', async () => {
    provider.reply = accepts;
    const res = await request(app)
      .put('/api/v1/ai/provider')
      .set('Cookie', ana)
      .send({ provider: 'openai', model: 'gpt-4.1' })
      .expect(200);
    expect(provider.calls[0]).toMatchObject({
      auth: 'Bearer sk-buena-1234',
      body: { model: 'gpt-4.1' },
    });
    expect(res.body.own.model).toBe('gpt-4.1');
  });

  it('quitarla vuelve a la IA de la app', async () => {
    const res = await request(app).delete('/api/v1/ai/provider').set('Cookie', ana).expect(200);
    expect(res.body.own).toBeNull();
    await ask(app, ana).expect(200);
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('sin TOKEN_ENCRYPTION_KEY no se pueden guardar claves', async () => {
    const bare = buildApp({}, { users: await testUsers(), pipeline, coachLlm: appLlm() });
    const cookie = await loginCookie(bare, 'ana@example.com');
    const res = await request(bare)
      .put('/api/v1/ai/provider')
      .set('Cookie', cookie)
      .send({ provider: 'deepseek', model: 'deepseek-flash', apiKey: 'sk-x' })
      .expect(503);
    expect(res.body.error.code).toBe('NO_ENCRYPTION_KEY');
  });
});
