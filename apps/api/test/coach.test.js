import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from './helpers.js';
import { loginCookie, testUsers } from './auth-helpers.js';
import { toModelHistory, titleFrom } from '../src/services/coach-store.js';

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
            },
          ]
        : [],
  },
};

/** LLM de mentira: cada llamada saca la siguiente respuesta del guion. */
function scriptedLlm(...script) {
  const calls = [];
  return {
    calls,
    model: 'deepseek-flash',
    async complete({ messages, tools, onDelta }) {
      calls.push({ messages: structuredClone(messages), tools });
      const next = script.shift();
      if (next instanceof Error) throw next;
      if (next.content) for (const piece of next.content.match(/.{1,4}/g)) onDelta?.(piece);
      return {
        message: { role: 'assistant', content: next.content ?? '', ...next.extra },
        usage: { prompt_tokens: 1_000_000, completion_tokens: 100_000, prompt_cache_hit_tokens: 0 },
        model: 'deepseek-flash',
      };
    },
  };
}

const listMetricsCall = {
  extra: {
    tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'list_metrics', arguments: '{}' } },
    ],
  },
};

/** Eventos de un cuerpo SSE. */
function events(text) {
  return text
    .split('\n\n')
    .filter((block) => block.startsWith('event:'))
    .map((block) => {
      const [, event] = /^event: (.+)$/m.exec(block);
      const [, data] = /^data: (.+)$/m.exec(block);
      return { event, data: JSON.parse(data) };
    });
}

const ask = (app, cookie, body) =>
  request(app)
    .post('/api/v1/coach/messages')
    .set('Cookie', cookie)
    .send(body)
    .buffer(true)
    .parse((res, done) => {
      let text = '';
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => done(null, text));
    });

describe('/api/v1/coach', () => {
  let app;
  let llm;
  let ana;
  let admin;
  let conversationId;
  const balance = {
    read: vi.fn(async () => ({
      available: true,
      balances: [{ currency: 'USD', total: 4.5, granted: 0, toppedUp: 4.5 }],
      checkedAt: '2026-10-17T10:00:00.000Z',
    })),
  };

  beforeAll(async () => {
    llm = scriptedLlm(
      listMetricsCall,
      { content: 'Tienes **peso** desde el 1 de octubre.' },
      { content: 'Sigue igual.' },
    );
    app = buildApp({}, { users: await testUsers(), pipeline, coachLlm: llm, llmBalance: balance });
    ana = await loginCookie(app, 'ana@example.com');
    admin = await loginCookie(app, 'admin@example.com');
  });

  it('sin sesión: 401', async () => {
    await request(app).get('/api/v1/coach/conversations').expect(401);
  });

  it('primera pregunta: crea la conversación, usa herramientas y contesta en streaming', async () => {
    const res = await ask(app, ana, {
      text: '¿Qué datos tengo?',
      context: { date: '2026-10-16' },
    }).expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(res.headers['content-encoding']).toBeUndefined();

    const stream = events(res.body);
    expect(stream.map((e) => e.event)).toEqual([
      'conversation',
      'user',
      'message',
      'tool',
      'tool_result',
      ...Array(10).fill('delta'),
      'message',
      'done',
    ]);
    const [conversation] = stream;
    expect(conversation.data).toMatchObject({ title: '¿Qué datos tengo?', created: true });
    conversationId = conversation.data.id;
    expect(stream.find((e) => e.event === 'tool').data).toMatchObject({ name: 'list_metrics' });
    expect(stream.at(-1).data.message.content).toBe('Tienes **peso** desde el 1 de octubre.');

    // Al modelo le llega el contexto y la herramienta lee los datos de Ana
    const [first, second] = llm.calls;
    expect(first.messages.at(-1).content).toBe(
      '[Está mirando el día 2026-10-16 en la app]\n¿Qué datos tengo?',
    );
    expect(first.tools.map((t) => t.function.name)).toContain('get_series');
    const toolResult = JSON.parse(second.messages.at(-1).content);
    expect(toolResult.metrics).toEqual([expect.objectContaining({ code: 'body.weight' })]);
  });

  it('la conversación queda guardada con todo, y la siguiente pregunta lleva el historial', async () => {
    const list = await request(app).get('/api/v1/coach/conversations').set('Cookie', ana);
    expect(list.body.items).toEqual([expect.objectContaining({ id: conversationId })]);

    const saved = await request(app)
      .get(`/api/v1/coach/conversations/${conversationId}`)
      .set('Cookie', ana)
      .expect(200);
    expect(saved.body.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(saved.body.messages[0].meta).toEqual({ context: { date: '2026-10-16' } });

    const res = await ask(app, ana, { conversationId, text: '¿Y ahora?' }).expect(200);
    expect(events(res.body)[0].data.created).toBe(false);
    expect(llm.calls[2].messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
      'user',
    ]);
  });

  it('show_chart: la gráfica sale en el stream y se guarda para volver a pintarla', async () => {
    const chartLlm = scriptedLlm(
      {
        extra: {
          tool_calls: [
            {
              id: 'g1',
              type: 'function',
              function: {
                name: 'show_chart',
                arguments:
                  '{"title":"Peso","metrics":["body.weight"],"from":"2026-10-01","to":"2026-10-02"}',
              },
            },
          ],
        },
      },
      { content: 'Bajas.' },
    );
    const chartPipeline = {
      queries: {
        ...pipeline.queries,
        series: async ({ userId }) =>
          userId === 'ana'
            ? {
                'body.weight': {
                  label: 'Peso',
                  unit: 'kg',
                  aggregation: 'avg',
                  points: [{ t: '2026-10-01T06:00:00.000Z', value: 81.2 }],
                },
              }
            : {},
      },
    };
    const chartApp = buildApp(
      {},
      { users: await testUsers(), pipeline: chartPipeline, coachLlm: chartLlm },
    );
    const cookie = await loginCookie(chartApp, 'ana@example.com');

    const stream = events((await ask(chartApp, cookie, { text: '¿Peso?' }).expect(200)).body);
    const result = stream.find((e) => e.event === 'tool_result').data;
    expect(result).toMatchObject({
      id: 'g1',
      ok: true,
      display: {
        type: 'chart',
        labels: ['2026-10-01', '2026-10-02'],
        series: [{ code: 'body.weight', values: [81.2, null] }],
      },
    });
    expect(chartLlm.calls[0].tools.map((t) => t.function.name)).toContain('show_chart');
    // Al modelo solo le vuelve el resumen
    expect(JSON.parse(chartLlm.calls[1].messages.at(-1).content)).toMatchObject({ shown: true });

    const id = stream[0].data.id;
    const saved = await request(chartApp)
      .get(`/api/v1/coach/conversations/${id}`)
      .set('Cookie', cookie)
      .expect(200);
    const tool = saved.body.messages.find((m) => m.role === 'tool');
    expect(tool.meta.display).toEqual(result.display);
  });

  it('las conversaciones de otro no se ven, ni se puede escribir en ellas', async () => {
    const list = await request(app).get('/api/v1/coach/conversations').set('Cookie', admin);
    expect(list.body.items).toEqual([]);
    await request(app)
      .get(`/api/v1/coach/conversations/${conversationId}`)
      .set('Cookie', admin)
      .expect(404);
    await request(app)
      .post('/api/v1/coach/messages')
      .set('Cookie', admin)
      .send({ conversationId, text: 'hola' })
      .expect(404);
  });

  it('si el modelo falla, el stream acaba con un evento error', async () => {
    const failing = scriptedLlm(
      Object.assign(new Error('402: Insufficient Balance'), { name: 'LlmError' }),
    );
    const other = buildApp({}, { users: await testUsers(), pipeline, coachLlm: failing });
    const cookie = await loginCookie(other, 'ana@example.com');
    const res = await ask(other, cookie, { text: 'hola' }).expect(200);
    expect(events(res.body).at(-1)).toEqual({
      event: 'error',
      data: { message: 'El modelo no ha podido contestar (402: Insufficient Balance)' },
    });
  });

  it('admin → IA: saldo, días de margen y el gasto del coach (solo admin)', async () => {
    await request(app).get('/api/v1/admin/ai').set('Cookie', ana).expect(403);

    const res = await request(app).get('/api/v1/admin/ai').set('Cookie', admin).expect(200);
    expect(res.body.models).toEqual([
      expect.objectContaining({ feature: 'nutrition', configured: false }),
      expect.objectContaining({ feature: 'coach', model: 'deepseek-flash', configured: true }),
      // Sin cola no hay informes médicos (los lee el worker)
      expect.objectContaining({ feature: 'clinical', configured: false }),
    ]);
    // 3 llamadas de 1M de entrada (0,28 $) y 100k de salida (0,042 $)
    const { usage, balance: account } = res.body;
    expect(usage.today.calls).toBe(3);
    expect(usage.today.costUsd).toBeCloseTo(3 * 0.322, 6);
    expect(usage.features).toEqual([expect.objectContaining({ feature: 'coach', calls: 3 })]);
    expect(usage.days).toHaveLength(30);
    expect(usage.recent[0]).toMatchObject({ feature: 'coach', userId: 'ana', conversationId });
    expect(account.balances[0].total).toBe(4.5);
    expect(account.runwayDays).toBeCloseTo(4.5 / ((3 * 0.322) / 7), 3);
    // 4,5 $ dan para un mes a este ritmo: no es bajo
    expect(account.low).toBe(false);
  });

  it('borrar una conversación', async () => {
    await request(app)
      .delete(`/api/v1/coach/conversations/${conversationId}`)
      .set('Cookie', ana)
      .expect(204);
    await request(app)
      .get(`/api/v1/coach/conversations/${conversationId}`)
      .set('Cookie', ana)
      .expect(404);
  });

  it('sin LLM del coach no se monta', async () => {
    const bare = buildApp({}, { users: await testUsers(), pipeline });
    const cookie = await loginCookie(bare, 'ana@example.com');
    await request(bare).get('/api/v1/coach/conversations').set('Cookie', cookie).expect(404);
  });
});

describe('historial para el modelo', () => {
  const m = (role, extra = {}) => ({ role, content: role, ...extra });

  it('corta por el límite pero siempre empezando por una pregunta', () => {
    const messages = [
      m('user'),
      m('assistant', { toolCalls: [{ id: 'x' }] }),
      m('tool', { toolCallId: 'x' }),
      m('assistant'),
      m('user'),
      m('assistant'),
    ];
    expect(toModelHistory(messages, 3).map((x) => x.role)).toEqual(['user', 'assistant']);
    expect(toModelHistory(messages, 5).map((x) => x.role)).toEqual(['user', 'assistant']);
    expect(toModelHistory(messages, 6).map((x) => x.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(toModelHistory(messages, 6)[1].tool_calls).toEqual([{ id: 'x' }]);
    expect(toModelHistory(messages, 6)[2].tool_call_id).toBe('x');
  });

  it('título: primera línea, recortada', () => {
    expect(titleFrom('  ¿Cómo  duermo?\nmás cosas')).toBe('¿Cómo duermo?');
    expect(titleFrom('a'.repeat(80))).toHaveLength(58);
  });
});
