import { describe, it, expect } from 'vitest';
import { createTools } from '../src/tools.js';

const base = { queries: {}, userId: 'u1', timeZone: 'Europe/Madrid' };

describe('herramientas de perfil y motor', () => {
  it('solo existen si se les da de dónde sacar los datos', () => {
    const names = createTools(base).map((t) => t.name);
    expect(names).not.toContain('get_profile');
    expect(names).not.toContain('get_engine');
  });

  it('get_engine: estado y una fila por día con peso, tendencia y gasto', async () => {
    const state = {
      ready: true,
      weight: { trend: 81.8 },
      expenditure: {
        kcal: 2410,
        confidence: 'low',
        history: [{ date: '2026-10-20', kcal: 2420 }],
      },
      targets: { kcal: 1990, proteinG: 150 },
      trend: [{ date: '2026-10-20', weight: 81.8, trend: 81.7 }],
    };
    const tool = createTools({ ...base, getEngine: async () => state }).find(
      (t) => t.name === 'get_engine',
    );
    const out = await tool.handler({});
    expect(out.expenditure).toEqual({ kcal: 2410, confidence: 'low' });
    expect(out.history).toEqual([
      { date: '2026-10-20', weight: 81.8, trend: 81.7, expenditure: 2420 },
    ]);
    expect(out.targets.kcal).toBe(1990);
  });

  it('get_engine sin datos suficientes dice qué falta', async () => {
    const tool = createTools({
      ...base,
      getEngine: async () => ({ ready: false, missing: ['age'] }),
    }).find((t) => t.name === 'get_engine');
    expect(await tool.handler({})).toEqual({ ready: false, missing: ['age'] });
  });
});
