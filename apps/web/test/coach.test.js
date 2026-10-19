import { describe, expect, it } from 'vitest';
import { createSseParser } from '../src/api.js';
import { toChat, toolLabel } from '../src/services/coach.js';

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
