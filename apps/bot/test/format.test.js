import { describe, it, expect } from 'vitest';
import { formatAnalysis } from '../src/format.js';

const item = (name, quantity, unit, kcal, proteinG, carbsG, fatG, fiberG = 0) => ({
  name,
  quantity,
  unit,
  kcal,
  proteinG,
  carbsG,
  fatG,
  fiberG,
});

const analysis = {
  dishes: [
    {
      name: 'Flan',
      eatenAt: '2026-10-13T12:30:00.000Z',
      items: [item('Flan de huevo', 1, 'unidad', 150, 4, 25, 4)],
    },
    {
      name: 'Bocadillo de pavo & queso',
      eatenAt: '2026-10-13T12:00:00.000Z',
      items: [
        item('Pan de centeno', 80, 'g', 190, 6.4, 36, 1.6, 4.5),
        item('Pavo', 2, 'lonchas', 40, 8, 0.6, 0.6),
        item('Sal', null, '', 0, 0, 0, 0),
      ],
    },
  ],
  notes: 'Pan estimado',
};

const format = (now = new Date('2026-10-13T15:00:00Z')) =>
  formatAnalysis(analysis, { timeZone: 'Europe/Madrid', now });

describe('formatAnalysis', () => {
  it('agrupa por plato con subtotal, ingredientes con macros y total', () => {
    expect(format()).toBe(
      [
        '🍽 <b>Esto es lo que he entendido</b>',
        '',
        '<b>14:00 · Bocadillo de pavo &amp; queso</b>',
        '<b>230 kcal</b> · P 14.4 · HC 36.6 · G 2.2',
        '  • Pan de centeno 80 g — 190 kcal · P 6.4 · HC 36 · G 1.6',
        '  • Pavo 2 lonchas — 40 kcal · P 8 · HC 0.6 · G 0.6',
        '  • Sal — 0 kcal · P 0 · HC 0 · G 0',
        '',
        '<b>14:30 · Flan</b> · 1 unidad',
        '150 kcal · P 4 · HC 25 · G 4',
        '',
        '<b>Total: 380 kcal</b>',
        'P 18.4 g · HC 61.6 g · G 6.2 g · Fibra 4.5 g',
        '',
        '<i>Pan estimado</i>',
      ].join('\n'),
    );
  });

  it('muestra la fecha si no es de hoy', () => {
    expect(format(new Date('2026-10-14T10:00:00Z'))).toContain('<b>13/10 14:30 · Flan</b>');
  });
});
