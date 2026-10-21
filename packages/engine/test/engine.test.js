import { describe, it, expect } from 'vitest';
import {
  addDays,
  bmr,
  computeState,
  energyPerKg,
  fillWeights,
  initialExpenditure,
  isLoggedDay,
  nutritionTargets,
  weightTrend,
} from '../src/index.js';

/** Días seguidos desde `start` con lo que devuelva `fn(i)`. */
const series = (start, n, fn) =>
  Array.from({ length: n }, (_, i) => ({ date: addDays(start, i), ...fn(i) }));

describe('peso', () => {
  it('rellena los huecos en línea recta y mantiene el último', () => {
    const days = [{ weight: 80 }, { weight: null }, { weight: 82 }, { weight: null }].map(
      (d, i) => ({
        date: addDays('2026-10-01', i),
        ...d,
      }),
    );
    expect(fillWeights(days)).toEqual([80, 81, 82, 82]);
  });

  it('un hueco de semanas no se rellena: la tendencia vuelve a arrancar después', () => {
    const days = Array.from({ length: 30 }, (_, i) => ({
      date: addDays('2026-09-01', i),
      weight: i === 0 ? 78 : i >= 25 ? 82 : null,
    }));
    const trend = weightTrend(days);
    expect(trend[10].trend).toBeNull();
    expect(trend[29].trend).toBeCloseTo(82, 1);
  });

  it('la tendencia no se asusta por un día de agua ni por un primer pesaje raro', () => {
    const weights = [84, 81, 81.2, 80.9, 81, 81.1, 82.6, 81, 81.1];
    const trend = weightTrend(
      weights.map((weight, i) => ({ date: addDays('2026-10-01', i), weight })),
    );
    const values = trend.map((d) => d.trend);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThan(0.3);
    expect(values.at(-1)).toBeCloseTo(81.1, 0);
  });
});

describe('gasto', () => {
  it('basal por fórmula y arranque rebajado según el ritmo de pérdida', () => {
    expect(bmr({ weightKg: 82, heightCm: 185, age: 42, sex: 'male' })).toBeCloseTo(1771, 0);
    const maintain = initialExpenditure({ bmr: 1770, avgSteps: 9000, weeklyRatePct: 0 });
    const lose = initialExpenditure({ bmr: 1770, avgSteps: 9000, weeklyRatePct: -0.5 });
    expect(maintain).toBe(2580); // 1770 × 1,55 × 0,94
    expect(lose).toBeLessThan(maintain);
  });

  it('perdiendo rápido, cada kg tiene menos energía (entra músculo)', () => {
    expect(energyPerKg(-0.5)).toBeGreaterThan(energyPerKg(-1.2));
  });

  it('un día cuenta si es desde que lo apunta todo, completo y no es hoy', () => {
    const opts = { since: '2026-10-17', today: '2026-10-21', expected: 2400 };
    expect(isLoggedDay({ date: '2026-10-18', kcal: 2200, dishes: 8 }, opts)).toBe(true);
    expect(isLoggedDay({ date: '2026-10-16', kcal: 2200, dishes: 8 }, opts)).toBe(false);
    expect(isLoggedDay({ date: '2026-10-19', kcal: 490, dishes: 1 }, opts)).toBe(false);
    expect(isLoggedDay({ date: '2026-10-21', kcal: 2200, dishes: 8 }, opts)).toBe(false);
  });

  it('aprende el gasto real: si come 2.500 y su peso no se mueve, gasta ~2.500', () => {
    const days = series('2026-08-01', 60, () => ({
      weight: 80,
      kcal: 2500,
      dishes: 6,
      steps: 9000,
    }));
    const state = computeState({
      profile: { age: 40, sex: 'male', heightCm: 180, weeklyRatePct: 0 },
      days,
      today: '2026-09-30',
    });
    expect(state.expenditure.kcal).toBeGreaterThan(2440);
    expect(state.expenditure.kcal).toBeLessThan(2560);
    expect(state.expenditure.confidence).toBe('high');
  });

  it('si come 2.000 y baja 0,5 kg/semana, gasta unas 2.500 (el peso manda, no el reloj)', () => {
    const days = series('2026-08-01', 60, (i) => ({
      weight: 85 - (0.5 / 7) * i,
      kcal: 2000,
      dishes: 6,
      steps: 9000,
    }));
    const state = computeState({
      profile: { age: 40, sex: 'male', heightCm: 180, weeklyRatePct: 0 },
      days,
      today: '2026-09-30',
    });
    expect(state.expenditure.kcal).toBeGreaterThan(2350);
    expect(state.expenditure.kcal).toBeLessThan(2600);
  });

  it('sin días apuntados se queda en el de partida y lo dice', () => {
    const days = series('2026-10-01', 20, () => ({ weight: 80, kcal: null, dishes: 0 }));
    const state = computeState({
      profile: { age: 40, sex: 'male', heightCm: 180 },
      days,
      today: '2026-10-20',
    });
    expect(state.expenditure.kcal).toBe(state.expenditure.initial);
    expect(state.expenditure.confidence).toBe('none');
  });

  it('avisa si lo apuntado no cuadra con el peso (falta comida o es agua)', () => {
    const days = series('2026-10-01', 21, (i) => ({
      weight: 82 + 0.02 * i,
      kcal: 1500,
      dishes: 6,
    }));
    const state = computeState({
      profile: { age: 42, sex: 'male', heightCm: 185 },
      days,
      today: '2026-10-21',
    });
    expect(state.expenditure.mismatch).toBe(true);
  });

  it('con pocos días apuntados no avisa: el agua de una semana lo puede todo', () => {
    const days = series('2026-10-01', 21, (i) => ({
      weight: 82 + 0.02 * i,
      kcal: i >= 16 ? 1500 : null,
      dishes: i >= 16 ? 6 : 0,
    }));
    const state = computeState({
      profile: { age: 42, sex: 'male', heightCm: 185 },
      days,
      today: '2026-10-21',
    });
    expect(state.expenditure.mismatch).toBe(false);
  });
});

describe('objetivos', () => {
  it('kcal según el ritmo; proteína por masa magra; grasa mínima; el resto hidratos', () => {
    const t = nutritionTargets({
      expenditure: 2500,
      weightKg: 80,
      bodyFatPct: 20,
      weeklyRatePct: -0.5,
      density: energyPerKg(-0.5),
    });
    expect(t.kgPerWeek).toBe(-0.4);
    expect(t.kcal).toBe(2090);
    expect(t.proteinG).toBe(145); // 2,3 × 64 kg magros
    expect(t.fatG).toBe(65);
    // Los gramos van de 5 en 5: las kcal de los macros cuadran con unas decenas de margen
    expect(Math.abs(t.proteinG * 4 + t.fatG * 9 + t.carbsG * 4 - t.kcal)).toBeLessThanOrEqual(30);
  });

  it('sin edad o altura, no se inventa nada', () => {
    const state = computeState({
      profile: {},
      days: [{ date: '2026-10-01', weight: 80 }],
      today: '2026-10-02',
    });
    expect(state).toEqual({ ready: false, missing: ['age', 'heightCm'] });
  });
});
