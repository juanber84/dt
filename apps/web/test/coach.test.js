import { describe, expect, it } from 'vitest';
import { createSseParser } from '../src/api.js';
import {
  answerParts,
  applyEvent,
  chartGroups,
  chartLabels,
  rollingMean,
  setLabel,
  toChat,
  toolLabel,
} from '../src/services/coach.js';

describe('createSseParser', () => {
  it('saca eventos aunque los trozos corten las líneas, y se salta los comentarios', () => {
    const seen = [];
    const parse = createSseParser((event, data) => seen.push([event, data]));
    const text =
      'event: delta\ndata: {"text":"Ho"}\n\n: ping\n\nevent: delta\ndata: {"text":"la"}\n\nevent: done\ndata: {}\n\n';
    for (const piece of text.match(/[\s\S]{1,5}/g)) parse(piece);
    expect(seen).toEqual([
      ['delta', { text: 'Ho' }],
      ['delta', { text: 'la' }],
      ['done', {}],
    ]);
  });
});

describe('toChat', () => {
  it('una respuesta por pregunta, con las herramientas usadas y las que fallaron', () => {
    const call = (id, name, args) => ({
      id,
      type: 'function',
      function: { name, arguments: args },
    });
    const chat = toChat([
      { id: '1', role: 'user', content: '¿Peso?', meta: { context: { date: '2026-10-16' } } },
      {
        id: '2',
        role: 'assistant',
        content: 'Miro.',
        toolCalls: [
          call('a', 'list_metrics', '{}'),
          call('b', 'get_series', '{"from":"2026-10-01","to":"2026-10-16"}'),
        ],
      },
      { id: '3', role: 'tool', toolCallId: 'a', content: '{"metrics":[]}' },
      { id: '4', role: 'tool', toolCallId: 'b', content: 'Error: Por day como mucho 400 días' },
      { id: '5', role: 'assistant', content: 'Bajas.' },
      { id: '6', role: 'user', content: 'Gracias' },
    ]);

    expect(chat).toEqual([
      { id: '1', role: 'user', content: '¿Peso?', context: { date: '2026-10-16' } },
      {
        id: '5',
        role: 'assistant',
        content: 'Miro.\n\nBajas.',
        charts: [],
        tools: [
          { id: 'a', name: 'list_metrics', args: {}, ok: true },
          {
            id: 'b',
            name: 'get_series',
            args: { from: '2026-10-01', to: '2026-10-16' },
            ok: false,
          },
        ],
      },
      { id: '6', role: 'user', content: 'Gracias', context: undefined },
    ]);
  });

  it('nombres de herramientas para personas', () => {
    expect(toolLabel('get_day_summary', { date: '2026-10-16' })).toBe('Resumen del día 2026-10-16');
    expect(toolLabel('get_series', { from: '2026-10-01', to: '2026-10-16' })).toBe(
      'Series 2026-10-01 → 2026-10-16',
    );
    expect(toolLabel('otra')).toBe('otra');
  });
});

const weightChart = (extra = {}) => ({
  type: 'chart',
  title: 'Peso',
  bucket: 'day',
  kind: 'line',
  average: false,
  labels: ['2026-10-01', '2026-10-02', '2026-10-03'],
  series: [
    {
      code: 'body.weight',
      label: 'Peso',
      unit: 'kg',
      aggregation: 'avg',
      values: [81.2, null, 80.9],
    },
  ],
  ...extra,
});

describe('gráficas del coach', () => {
  it('toChat pone cada gráfica donde iba el texto', () => {
    const chat = toChat([
      { id: '1', role: 'user', content: '¿Peso?' },
      {
        id: '2',
        role: 'assistant',
        content: 'Mira.',
        toolCalls: [{ id: 'g', function: { name: 'show_chart', arguments: '{"title":"Peso"}' } }],
      },
      {
        id: '3',
        role: 'tool',
        toolCallId: 'g',
        content: '{"shown":true}',
        meta: { display: weightChart() },
      },
      { id: '4', role: 'assistant', content: 'Bajas.' },
    ]);
    const answer = chat[1];
    expect(answer.charts).toEqual([{ id: 'g', at: 5, chart: weightChart() }]);
    expect(answerParts(answer).map((p) => [p.type, p.text ?? p.chart.title])).toEqual([
      ['text', 'Mira.'],
      ['chart', 'Peso'],
      ['text', 'Bajas.'],
    ]);
    expect(toolLabel('show_chart', { title: 'Peso' })).toBe('Gráfica: Peso');
  });

  it('una gráfica por unidad; columnas solo con una serie', () => {
    const groups = chartGroups(
      weightChart({
        kind: 'bar',
        series: [
          { code: 'a', label: 'Kcal comidas', unit: 'kcal', aggregation: 'sum', values: [1, 2, 3] },
          {
            code: 'b',
            label: 'Kcal gastadas',
            unit: 'kcal',
            aggregation: 'sum',
            values: [2, 2, 2],
          },
          { code: 'c', label: 'Pasos', unit: 'pasos', aggregation: 'sum', values: [5, 6, 7] },
        ],
      }),
    );
    expect(groups.map((g) => [g.unit, g.kind, g.series.length, g.legend.length])).toEqual([
      ['kcal', 'line', 2, 2],
      ['pasos', 'bar', 1, 0],
    ]);
    // El color va con la serie, no con su grupo
    expect(groups[1].series[0].color).toBe('var(--nutrition)');
  });

  it('con la media de 7 días, el dato diario en gris y la media en color', () => {
    const [group] = chartGroups(weightChart({ average: true }));
    expect(group.series.map((s) => [s.label, s.color])).toEqual([
      ['Peso', 'var(--axis)'],
      ['Media de 7 días', 'var(--sleep)'],
    ]);
    expect(group.decimals).toBe(1);
    // Con hueco: la media sale de los días con dato, si hay al menos 3
    expect(rollingMean([1, 2, 3, null, 4], 4)).toEqual([null, null, 2, 2, 3]);
    expect(rollingMean([1, 2, 3, 6], 7)).toEqual([null, null, 2, 3]);
  });

  it('etiquetas por día o por hora (con el día si hay varios)', () => {
    expect(chartLabels(weightChart())[0]).toMatch(/^1 oct/);
    expect(
      chartLabels({ bucket: 'hour', labels: ['2026-10-01 23:00', '2026-10-02 00:00'] }),
    ).toEqual(['1 oct 23:00', '2 oct 00:00']);
    expect(chartLabels({ bucket: 'hour', labels: ['2026-10-01 08:00'] })).toEqual(['08:00']);
  });
});

describe('applyEvent', () => {
  it('arma la respuesta con lo que llega del stream', () => {
    const answer = { id: null, content: '', tools: [], charts: [] };
    const events = [
      ['tool', { id: 'a', name: 'get_series', args: { from: '2026-10-01' } }],
      ['tool', { id: 'b', name: 'show_chart', args: {} }],
      ['delta', { text: 'Miro.' }],
      ['message', { id: 'm1', content: 'Miro.', toolCalls: [{}] }],
      ['tool_result', { id: 'a', ok: true }],
      ['tool_result', { id: 'b', ok: true, display: { type: 'chart', title: 'Peso' } }],
      ['tool_result', { id: 'otra', ok: false }],
      ['delta', { text: 'Bajas.' }],
      ['message', { id: 'm2', content: 'Bajas.' }],
      ['conversation', { id: 'c1', title: 'Peso' }],
      ['done', {}],
    ];
    for (const [event, data] of events) applyEvent(answer, event, data);
    expect(answer).toEqual({
      id: 'm2',
      content: 'Miro.\n\nBajas.',
      tools: [
        { id: 'a', name: 'get_series', args: { from: '2026-10-01' }, ok: true },
        { id: 'b', name: 'show_chart', args: {}, ok: true },
      ],
      charts: [{ id: 'b', at: 7, chart: { type: 'chart', title: 'Peso' } }],
    });
  });

  it('un error del stream queda en la respuesta', () => {
    const answer = { content: '', tools: [], charts: [] };
    applyEvent(answer, 'error', { message: 'Sin saldo' });
    expect(answer.error).toBe('Sin saldo');
  });
});

describe('plantillas de fuerza en el chat', () => {
  const template = {
    type: 'strength-template',
    app: 'motra',
    appLabel: 'Fuerza (experimental)',
    session: {
      name: 'Pierna A',
      exercises: [{ exerciseId: 'squat', name: 'Back Squat', sets: [{ reps: 5, weightKg: 80 }] }],
    },
  };

  it('en vivo: la tarjeta sale donde va el texto y recibe su mensaje para el botón', () => {
    const answer = { id: null, content: '', tools: [], charts: [] };
    applyEvent(answer, 'delta', { text: 'Toma.' });
    applyEvent(answer, 'tool_result', { id: 'p1', ok: true, display: template });
    expect(answer.charts).toEqual([{ id: 'p1', at: 5, template, messageId: null }]);
    applyEvent(answer, 'display', { id: '42', toolCallId: 'p1' });
    expect(answer.charts[0].messageId).toBe('42');
    expect(answerParts(answer).map((p) => p.type)).toEqual(['text', 'template']);
    expect(answerParts(answer)[1].entry).toBe(answer.charts[0]);
  });

  it('al abrir la conversación: la tarjeta con su mensaje (y si ya se guardó)', () => {
    const saved = { ...template, saved: { id: 'T1', created: true } };
    const chat = toChat([
      { id: '1', role: 'user', content: 'Pierna' },
      {
        id: '2',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'p1', function: { name: 'propose_strength_template', arguments: '{}' } }],
      },
      { id: '3', role: 'tool', toolCallId: 'p1', content: '{}', meta: { display: saved } },
      { id: '4', role: 'assistant', content: 'Ahí la tienes.' },
    ]);
    expect(chat[1].charts).toEqual([{ id: 'p1', at: 0, template: saved, messageId: '3' }]);
    expect(toolLabel('propose_strength_template', { name: 'Pierna A' })).toBe(
      'Plantilla: Pierna A',
    );
  });

  it('setLabel: reps con kilos, sin peso o por tiempo', () => {
    expect(setLabel({ reps: 5, weightKg: 82.5 })).toBe('5 × 82,5 kg');
    expect(setLabel({ reps: 12 })).toBe('12');
    expect(setLabel({ timeS: 60 })).toBe('60 s');
  });
});
