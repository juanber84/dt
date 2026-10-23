import { describe, it, expect } from 'vitest';
import { buildContext } from '../src/context.js';
import { systemPrompt } from '../src/prompt.js';

const TZ = 'Europe/Madrid';

describe('contexto del coach', () => {
  it('perfil y salud: nota del médico, síntomas y la medicación agrupada', () => {
    const text = buildContext({
      timeZone: TZ,
      profile: { sex: 'male', age: 42, heightCm: 185, weightGoalKg: 81.6 },
      health: [
        { kind: 'note', start: '2026-10-19T11:00:00Z', title: 'Médico: laringitis' },
        {
          kind: 'medication',
          start: '2026-10-19T21:00:00Z',
          title: 'Enantyum',
          summary: { dose: '1 comprimido' },
        },
        {
          kind: 'medication',
          start: '2026-10-20T05:00:00Z',
          title: 'Enantyum',
          summary: { dose: '1 comprimido' },
        },
        {
          kind: 'symptom',
          start: '2026-10-21T10:00:00Z',
          title: 'Mocos',
          summary: { intensity: 4 },
        },
      ],
    });
    expect(text).toContain('Persona: hombre, 42 años, 185 cm. Peso objetivo: 81.6 kg.');
    expect(text).toContain('Nota (');
    expect(text).toContain('Médico: laringitis');
    expect(text).toContain('Síntoma (');
    expect(text).toContain('Mocos 4/5');
    expect(text).toMatch(/Medicación: Enantyum \(1 comprimido\): 2 tomas/);
  });

  it('sin perfil ni salud lo dice (y que lo pida si hace falta)', () => {
    const text = buildContext({ timeZone: TZ });
    expect(text).toContain('no ha rellenado su edad');
    expect(text).toContain('nada apuntado');
  });

  it('va dentro de las instrucciones', () => {
    const prompt = systemPrompt({ now: new Date(), timeZone: TZ, context: 'Persona: hombre.' });
    expect(prompt).toContain('Persona: hombre.');
    expect(prompt).toContain('Lo primero, su salud');
  });

  it('un periodo: fuera de casa (mantenimiento, sin reproches) o recién vuelto (el peso es agua)', () => {
    const engine = {
      ready: true,
      weight: { trend: 81.8, last: 81.5, bodyFat: null },
      expenditure: { kcal: 2300, confidence: 'high', loggedDays: 30, intakeAvg: null },
      weeklyRatePct: -0.5,
      targets: { kcal: 2300, proteinG: 150, fatG: 65, carbsG: 290, kgPerWeek: 0 },
    };
    const during = buildContext({
      timeZone: TZ,
      engine: {
        ...engine,
        period: { type: 'away', from: '2026-11-01', to: '2026-11-04', phase: 'during' },
      },
    });
    expect(during).toContain('Ahora está fuera de casa (del 1/11 al 4/11)');
    expect(during).toContain('No le metas prisa con el déficit');

    const back = buildContext({
      timeZone: TZ,
      engine: {
        ...engine,
        period: {
          type: 'away',
          from: '2026-11-01',
          to: '2026-11-04',
          phase: 'settling',
          daysSince: 1,
        },
      },
    });
    expect(back).toContain('Volvió hace 1 día');
    expect(back).toContain('es sobre todo agua y sal');
  });
});
