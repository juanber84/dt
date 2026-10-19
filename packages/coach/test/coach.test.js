import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createChartTool,
  createChatClient,
  createCoach,
  LlmError,
  toolDefinitions,
} from '../src/index.js';

const NOW = new Date('2026-10-17T10:00:00Z');

/** Respuesta en streaming como la de DeepSeek: un `data:` por trozo y [DONE]. */
function stream(chunks, { split = false } = {}) {
  const text = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  // Trozos de red que cortan las líneas por la mitad
  const parts = split ? text.match(/[\s\S]{1,7}/g) : [text];
  const body = new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const textReply = (...pieces) =>
  stream([
    ...pieces.map((content) => ({ model: 'deepseek-flash', choices: [{ delta: { content } }] })),
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } },
  ]);

const toolReply = (calls, options) =>
  stream(
    [
      ...calls.flatMap(({ id, name, args }, index) => [
        {
          choices: [{ delta: { tool_calls: [{ index, id, function: { name, arguments: '' } }] } }],
        },
        // Los argumentos llegan troceados
        ...[args.slice(0, 5), args.slice(5)].map((part) => ({
          choices: [{ delta: { tool_calls: [{ index, function: { arguments: part } }] } }],
        })),
      ]),
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 50, completion_tokens: 10 } },
    ],
    options,
  );

function build(...responses) {
  const fetch = vi.fn();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  const llm = createChatClient({
    apiKey: 'sk-test',
    baseUrl: 'https://api.deepseek.com/',
    model: 'deepseek-flash',
    fetch,
  });
  return { fetch, llm };
}

const sent = (fetch, call = 0) => JSON.parse(fetch.mock.calls[call][1].body);

const weightTool = {
  name: 'get_series',
  description: 'Series',
  inputSchema: {
    metrics: z.array(z.string()).min(1),
    bucket: z.enum(['day', 'hour']).default('day'),
  },
  handler: vi.fn(async ({ metrics, bucket }) => ({ metrics, bucket, points: [81.2, 81.0] })),
};

describe('createChatClient', () => {
  it('junta el texto en streaming, avisa de cada trozo y devuelve el uso', async () => {
    const { fetch, llm } = build(textReply('Hola', ', ', 'qué tal'));
    const deltas = [];
    const result = await llm.complete({
      messages: [{ role: 'user', content: 'hola' }],
      onDelta: (t) => deltas.push(t),
    });

    expect(fetch.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
    expect(sent(fetch)).toMatchObject({ model: 'deepseek-flash', stream: true });
    expect(sent(fetch).tools).toBeUndefined();
    expect(deltas).toEqual(['Hola', ', ', 'qué tal']);
    expect(result).toMatchObject({
      message: { role: 'assistant', content: 'Hola, qué tal' },
      usage: { prompt_tokens: 100, completion_tokens: 20 },
      finishReason: 'stop',
    });
  });

  it('reconstruye llamadas a herramientas troceadas aunque la red corte las líneas', async () => {
    const { llm } = build(
      toolReply(
        [
          { id: 'c1', name: 'get_series', args: '{"metrics":["body.weight"]}' },
          { id: 'c2', name: 'list_metrics', args: '{}' },
        ],
        { split: true },
      ),
    );
    const { message } = await llm.complete({ messages: [] });
    expect(message.tool_calls).toEqual([
      {
        id: 'c1',
        type: 'function',
        function: { name: 'get_series', arguments: '{"metrics":["body.weight"]}' },
      },
      { id: 'c2', type: 'function', function: { name: 'list_metrics', arguments: '{}' } },
    ]);
  });

  it('un error HTTP es un LlmError con el status', async () => {
    const { llm } = build(
      new Response(JSON.stringify({ error: { message: 'Insufficient Balance' } }), {
        status: 402,
      }),
    );
    const error = await llm.complete({ messages: [] }).catch((e) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ status: 402, message: '402: Insufficient Balance' });
  });
});

describe('toolDefinitions', () => {
  it('pasa el shape de zod a JSON Schema, con los defaults como opcionales', () => {
    const [definition] = toolDefinitions([weightTool]);
    expect(definition.type).toBe('function');
    expect(definition.function.name).toBe('get_series');
    expect(definition.function.parameters).toMatchObject({
      type: 'object',
      properties: { metrics: { type: 'array' }, bucket: { enum: ['day', 'hour'] } },
      required: ['metrics'],
    });
    expect(definition.function.parameters.$schema).toBeUndefined();
  });
});

describe('createCoach', () => {
  it('ejecuta las herramientas que pide el modelo y vuelve con el resultado', async () => {
    const { fetch, llm } = build(
      toolReply([{ id: 'c1', name: 'get_series', args: '{"metrics":["body.weight"]}' }]),
      textReply('Bajas 0,2 kg.'),
    );
    const events = [];
    const saved = [];
    const usage = [];
    const coach = createCoach({ llm, timeZone: 'Europe/Madrid', now: () => NOW });

    const final = await coach.run({
      history: [{ role: 'user', content: '¿Cómo va mi peso?' }],
      tools: [weightTool],
      userName: 'Juan',
      onEvent: (e) => events.push(e),
      onMessage: (m) => saved.push(m),
      onUsage: (u) => usage.push(u),
    });

    expect(final).toEqual({ role: 'assistant', content: 'Bajas 0,2 kg.' });
    expect(weightTool.handler).toHaveBeenCalledWith({ metrics: ['body.weight'], bucket: 'day' });
    expect(events).toEqual([
      { type: 'tool', id: 'c1', name: 'get_series', args: { metrics: ['body.weight'] } },
      { type: 'tool_result', id: 'c1', ok: true },
      { type: 'delta', text: 'Bajas 0,2 kg.' },
    ]);
    expect(saved.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
    expect(usage).toHaveLength(2);

    const first = sent(fetch, 0);
    expect(first.messages[0].role).toBe('system');
    expect(first.messages[0].content).toContain('Juan');
    expect(first.messages[0].content).toContain('17 de octubre de 2026');
    expect(first.tools[0].function.name).toBe('get_series');
    // La segunda vuelta lleva la llamada y su resultado
    const second = sent(fetch, 1).messages;
    expect(second.at(-2).tool_calls[0].id).toBe('c1');
    expect(second.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
    expect(JSON.parse(second.at(-1).content).points).toEqual([81.2, 81.0]);
  });

  it('argumentos inválidos, herramientas que no existen y ToolError se le cuentan al modelo', async () => {
    const failing = {
      name: 'get_episodes',
      description: 'x',
      inputSchema: {},
      handler: async () => {
        throw Object.assign(new Error('Como mucho 31 días'), { name: 'ToolError' });
      },
    };
    const { fetch, llm } = build(
      toolReply([
        { id: 'a', name: 'get_series', args: '{"metrics":[]}' },
        { id: 'b', name: 'borrar_todo', args: '{}' },
        { id: 'c', name: 'get_episodes', args: '{}' },
      ]),
      textReply('Vale.'),
    );
    const events = [];
    await createCoach({ llm, timeZone: 'Europe/Madrid' }).run({
      history: [{ role: 'user', content: 'x' }],
      tools: [weightTool, failing],
      onEvent: (e) => events.push(e),
    });

    const results = sent(fetch, 1).messages.filter((m) => m.role === 'tool');
    expect(results.map((m) => m.content)).toEqual([
      expect.stringMatching(/^Error: argumentos no válidos \(metrics:/),
      'Error: no existe esa herramienta',
      'Error: Como mucho 31 días',
    ]);
    expect(events.filter((e) => e.type === 'tool_result').every((e) => !e.ok)).toBe(true);
  });

  it('en la última vuelta no ofrece herramientas: contesta con lo que tenga', async () => {
    const call = { id: 'c', name: 'get_series', args: '{"metrics":["x"]}' };
    const { fetch, llm } = build(toolReply([call]), toolReply([call]));
    const final = await createCoach({ llm, timeZone: 'Europe/Madrid', maxSteps: 2 }).run({
      history: [{ role: 'user', content: 'x' }],
      tools: [weightTool],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sent(fetch, 1).tool_choice).toBe('none');
    expect(final.tool_calls).toBeUndefined();
  });

  it('si el LLM falla, apunta el intento con el error y lo propaga', async () => {
    const { llm } = build(new Response('{}', { status: 500, statusText: 'Server Error' }));
    const usage = [];
    await expect(
      createCoach({ llm, timeZone: 'Europe/Madrid' }).run({
        history: [{ role: 'user', content: 'x' }],
        tools: [],
        onUsage: (u) => usage.push(u),
      }),
    ).rejects.toBeInstanceOf(LlmError);
    expect(usage).toEqual([expect.objectContaining({ usage: null, error: '500: Server Error' })]);
  });
});

const seriesOutput = {
  timeZone: 'Europe/Madrid',
  bucket: 'day',
  series: {
    'body.weight': {
      label: 'Peso',
      unit: 'kg',
      aggregation: 'avg',
      points: [
        { date: '2026-10-01', value: 81.2 },
        { date: '2026-10-03', value: 80.6 },
      ],
    },
  },
  noData: ['body.fat'],
};

describe('createChartTool', () => {
  it('la gráfica va entera a la app y al modelo solo un resumen', async () => {
    const getSeries = vi.fn(async () => seriesOutput);
    const tool = createChartTool({ getSeries });
    const { display, result } = await tool.handler({
      title: 'Peso',
      metrics: ['body.weight', 'body.fat'],
      from: '2026-10-01',
      to: '2026-10-03',
    });

    expect(getSeries).toHaveBeenCalledWith({
      metrics: ['body.weight', 'body.fat'],
      from: '2026-10-01',
      to: '2026-10-03',
      bucket: 'day',
    });
    expect(display).toEqual({
      title: 'Peso',
      bucket: 'day',
      kind: 'line',
      average: false,
      // Todos los días del rango: el que falta queda como hueco
      labels: ['2026-10-01', '2026-10-02', '2026-10-03'],
      series: [
        {
          code: 'body.weight',
          label: 'Peso',
          unit: 'kg',
          aggregation: 'avg',
          values: [81.2, null, 80.6],
        },
      ],
    });
    expect(result).toEqual({
      shown: true,
      series: [
        {
          code: 'body.weight',
          label: 'Peso',
          unit: 'kg',
          points: 2,
          min: 80.6,
          max: 81.2,
          mean: 80.9,
          first: { at: '2026-10-01', value: 81.2 },
          last: { at: '2026-10-03', value: 80.6 },
        },
      ],
      noData: ['body.fat'],
    });
  });

  it('sin datos se lo dice al modelo (ToolError)', async () => {
    const tool = createChartTool({ getSeries: async () => ({ series: {} }) });
    await expect(
      tool.handler({ title: 'x', metrics: ['a'], from: '2026-10-01', to: '2026-10-02' }),
    ).rejects.toMatchObject({ name: 'ToolError' });
  });

  it('en el coach: display a la app (evento y mensaje guardado), no al modelo', async () => {
    const { fetch, llm } = build(
      toolReply([
        {
          id: 'g1',
          name: 'show_chart',
          args: '{"title":"Peso","metrics":["body.weight"],"from":"2026-10-01","to":"2026-10-03"}',
        },
      ]),
      textReply('Bajas.'),
    );
    const events = [];
    const saved = [];
    const coach = createCoach({ llm, timeZone: 'Europe/Madrid', now: () => NOW });
    await coach.run({
      history: [{ role: 'user', content: '¿Peso?' }],
      tools: [createChartTool({ getSeries: async () => seriesOutput })],
      onEvent: (e) => events.push(e),
      onMessage: (m) => saved.push(m),
    });

    const result = events.find((e) => e.type === 'tool_result');
    expect(result).toMatchObject({ id: 'g1', ok: true, display: { type: 'chart', title: 'Peso' } });
    expect(saved[1]).toMatchObject({ role: 'tool', display: { type: 'chart' } });
    const toModel = sent(fetch, 1).messages.at(-1);
    expect(toModel.display).toBeUndefined();
    expect(JSON.parse(toModel.content)).toMatchObject({ shown: true });
    expect(toModel.content).not.toContain('labels');
  });
});
