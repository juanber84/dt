import { describe, it, expect } from 'vitest';
import {
  addDays,
  bmr,
  computeState,
  creatineNotice,
  creatinePhrase,
  currentPeriod,
  energyPerKg,
  fillWeights,
  initialExpenditure,
  isLoggedDay,
  markPeriods,
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

describe('periodos (fuera de casa, enfermo)', () => {
  const profile = { age: 40, sex: 'male', heightCm: 180, weeklyRatePct: -0.5 };

  it('marca los días del periodo y los 3 siguientes', () => {
    const days = series('2026-11-01', 9, () => ({}));
    const marked = markPeriods(days, [{ type: 'away', from: '2026-11-02', to: '2026-11-04' }]);
    expect(marked.map((d) => d.period ?? '-')).toEqual([
      '-',
      'away',
      'away',
      'away',
      'settling',
      'settling',
      'settling',
      '-',
      '-',
    ]);
    expect(
      markPeriods(days, [{ type: 'sick', from: '2026-11-01', to: '2026-11-01' }])[0].period,
    ).toBe('sick');
  });

  it('fuera de casa: lo de otra báscula no entra y el hueco se mantiene en el peso de casa', () => {
    const days = markPeriods(
      series('2026-11-01', 6, (i) => ({ weight: [80, 80, 83, 83, 80, 80][i] })),
      [{ type: 'away', from: '2026-11-03', to: '2026-11-04' }],
    );
    const trend = weightTrend(days);
    // Los pesajes de fuera (83) no aparecen ni mueven la tendencia
    expect(trend[2].weight).toBeNull();
    expect(trend[3].filled).toBe(80);
    expect(trend[3].trend).toBe(80);
  });

  it('al volver, el salto de agua pesa un tercio en la tendencia', () => {
    const base = series('2026-11-01', 8, (i) => ({ weight: i < 5 ? 80 : 81.5 }));
    const plain = weightTrend(base);
    const marked = weightTrend(
      markPeriods(base, [{ type: 'away', from: '2026-11-03', to: '2026-11-05' }]),
    );
    // Día 6 (vuelta): sin periodo sube 0,15; con periodo, un tercio
    const rise = (t) => t[5].trend - t[4].trend;
    expect(rise(plain)).toBeCloseTo(0.15, 2);
    expect(rise(marked)).toBeCloseTo(0.05, 2);
  });

  it('el gasto no aprende de una semana que toca un periodo', () => {
    // 2 meses comiendo 2.500 con el peso estable, y un puente apuntado a medias (1.500 al día:
    // por encima del 40 % que el motor ya descarta solo)
    const days = series('2026-09-01', 60, (i) => ({
      weight: 80,
      kcal: i >= 50 && i < 54 ? 1500 : 2500,
      dishes: 4,
    }));
    const today = '2026-10-31';
    const without = computeState({ profile, days, today });
    const withPeriod = computeState({
      profile,
      days,
      today,
      periods: [{ type: 'away', from: '2026-10-21', to: '2026-10-24' }],
    });
    // Sin marcarlo, los días a medias le hacen creer que gasta menos
    expect(without.expenditure.kcal).toBeLessThan(withPeriod.expenditure.kcal - 50);
    expect(withPeriod.expenditure.kcal).toBeGreaterThan(2400);
  });

  it('durante el periodo, objetivo de mantenimiento; al volver, el normal y cuántos días hace', () => {
    const days = series('2026-09-01', 61, () => ({ weight: 80, kcal: 2500, dishes: 4 }));
    const period = { type: 'away', from: '2026-10-30', to: '2026-11-02' };
    const during = computeState({ profile, days, today: '2026-10-31', periods: [period] });
    expect(during.period).toMatchObject({ type: 'away', phase: 'during' });
    expect(during.targets.kgPerWeek).toBe(0);
    expect(during.targets.kcal).toBe(during.expenditure.kcal);

    const back = computeState({
      profile,
      days,
      today: '2026-10-31',
      periods: [{ ...period, from: '2026-10-25', to: '2026-10-29' }],
    });
    expect(back.period).toMatchObject({ phase: 'settling', daysSince: 2 });
    expect(back.targets.kgPerWeek).toBeLessThan(0);
    expect(currentPeriod([period], '2026-11-10')).toBeNull();
  });
});

describe('creatina (solo aviso)', () => {
  const creatine = (startedOn, stoppedOn = null) => ({
    type: 'creatine',
    name: 'Creatina',
    startedOn,
    stoppedOn,
  });

  it('avisa las 4 semanas después de empezar y después ya no', () => {
    expect(creatineNotice([creatine('2026-10-20')], '2026-10-26')).toEqual({
      phase: 'starting',
      name: 'Creatina',
      since: '2026-10-20',
      daysSince: 6,
    });
    expect(creatineNotice([creatine('2026-10-20')], '2026-11-16')?.daysSince).toBe(27);
    expect(creatineNotice([creatine('2026-10-20')], '2026-11-17')).toBeNull();
    // Apuntada para empezar mañana: aún nada
    expect(creatineNotice([creatine('2026-10-27')], '2026-10-26')).toBeNull();
  });

  it('al dejarla también avisa (baja agua), salvo si apenas la tomó', () => {
    expect(creatineNotice([creatine('2026-08-01', '2026-10-20')], '2026-10-26')).toMatchObject({
      phase: 'stopping',
      since: '2026-10-20',
    });
    expect(creatineNotice([creatine('2026-10-15', '2026-10-18')], '2026-10-26')).toBeNull();
    // Dejarla más adelante (fecha futura) es que aún la toma
    expect(creatineNotice([creatine('2026-10-20', '2026-12-01')], '2026-10-26')?.phase).toBe(
      'starting',
    );
  });

  it('los demás suplementos no avisan', () => {
    const magnesium = { type: 'magnesium', name: 'Magnesio', startedOn: '2026-10-20' };
    expect(creatineNotice([magnesium], '2026-10-26')).toBeNull();
  });

  it('el motor no cambia sus cifras: solo añade el aviso', () => {
    const days = series('2026-08-01', 60, (i) => ({
      weight: 80 + 0.02 * i,
      kcal: 2500,
      dishes: 6,
      steps: 9000,
    }));
    const input = {
      profile: { age: 40, sex: 'male', heightCm: 180 },
      days,
      today: '2026-09-29',
    };
    const without = computeState(input);
    const withCreatine = computeState({ ...input, supplements: [creatine('2026-09-15')] });
    expect(without.creatine).toBeNull();
    expect(withCreatine.creatine).toMatchObject({ phase: 'starting', daysSince: 14 });
    expect({ ...withCreatine, creatine: null }).toEqual(without);
  });

  it('la frase para la persona', () => {
    expect(creatinePhrase({ phase: 'starting', since: '2026-10-20' })).toBe(
      'Empezaste la creatina el 20/10: las primeras 3-4 semanas el peso sube 1-2 kg de agua en el músculo. No es grasa: no recortes comida por eso.',
    );
    expect(creatinePhrase({ phase: 'stopping', since: '2026-11-03' })).toMatch(
      /^Dejaste la creatina el 3\/11: /,
    );
    expect(creatinePhrase(null)).toBe('');
  });
});
