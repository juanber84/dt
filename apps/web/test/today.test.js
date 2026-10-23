import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { bodyOf, insightOf, liters, recoveryOf, vitalsOf } from '../src/services/today.js';
import NutritionCard from '../src/components/today/NutritionCard.vue';
import BodyCard from '../src/components/today/BodyCard.vue';
import PeriodBanner from '../src/components/today/PeriodBanner.vue';

const sleep = { minutes: 420, need: 480, efficiency: 95, score: 88 };
const day = (extra = {}) => ({ hrv: 55, rhr: 50, recovery: null, sleep, ...extra });

describe('Hoy: cálculos', () => {
  it('recuperación por tramos; sin dato, sin calcular', () => {
    expect(recoveryOf(day()).label).toBe('Sin calcular');
    expect(recoveryOf(day({ recovery: 80 })).tone).toBe('good');
    expect(recoveryOf(day({ recovery: 50 })).tone).toBe('warning');
    expect(recoveryOf(day({ recovery: 10 })).tone).toBe('critical');
  });

  it('la frase: VFC frente a tu media, reposo, sueño que faltó y consejo', () => {
    const history = [{ hrv: 50 }, { hrv: 50 }, { hrv: null }];
    expect(insightOf(day({ recovery: 80, sleep: { ...sleep, minutes: 360 } }), history)).toBe(
      'VFC de 55 ms, un 10 % por encima de tu media, FC en reposo de 50 ppm, te faltaron 2h de sueño. Buen día para meter intensidad.',
    );
    expect(insightOf(day({ hrv: null, rhr: null, sleep: { ...sleep, minutes: 0 } }), [])).toBe(
      'Sin datos del reloj este día.',
    );
  });

  it('constantes: diferencia con la media solo si hay dato y media', () => {
    const vitals = vitalsOf(day({ spo2: 97.5 }), [
      { hrv: 50, rhr: 52 },
      { hrv: 60, rhr: 48 },
    ]);
    expect(vitals.find((v) => v.label === 'VFC')).toMatchObject({ value: '55', delta: 0 });
    // Sin SpO2 en la historia no hay con qué comparar (antes salía el propio valor como diferencia)
    expect(vitals.find((v) => v.label === 'SpO2').delta).toBeNull();
    expect(vitalsOf(null)).toEqual([]);
  });

  it('cuerpo: el último pesaje de los 30 días y cuánto ha cambiado', () => {
    const history = [
      { date: '2026-10-01', weight: 82 },
      { date: '2026-10-10', weight: null },
      { date: '2026-10-20', weight: 81.5 },
    ];
    expect(bodyOf(history, '2026-10-20')).toMatchObject({ isToday: true, delta: -0.5 });
    expect(bodyOf([{ date: '2026-10-01', weight: null }], '2026-10-20')).toBeNull();
    expect(liters(1450)).toBe('1,5');
    expect(liters(null)).toBe('—');
  });
});

describe('Hoy: tarjetas', () => {
  const nutrition = {
    kcal: 1989,
    protein: 86.2,
    carbs: 200.7,
    fat: 93,
    proteinTarget: 160,
    fluidMl: 1450,
    fluidTargetMl: 2500,
    waterMl: 1000,
    beveragesMl: 450,
  };

  it('Nutrición: frente al objetivo del motor, cifras en formato español', () => {
    const engine = {
      targets: { kcal: 1760, proteinG: 150, carbsG: 145, fatG: 65 },
      expenditure: { kcal: 2200, confidence: 'high' },
    };
    const text = mount(NutritionCard, { props: { day: { nutrition }, engine } }).text();
    expect(text).toContain('objetivo 1.760 kcal');
    expect(text).toContain('1.989');
    expect(text).toContain('86 / 150 g');
    expect(text).toContain('201 / 145 g');
    expect(text).toContain('1,5 / 2,5 L');
    expect(text).toContain('1,0 L de agua');
  });

  it('Nutrición sin comidas ni motor: lo dice, sin inventar objetivos', () => {
    const text = mount(NutritionCard, {
      props: { day: { nutrition: { ...nutrition, kcal: null, fluidMl: null } } },
    }).text();
    expect(text).toContain('Sin comidas apuntadas este día.');
    expect(text).not.toContain('objetivo');
  });

  it('Cuerpo y periodo', () => {
    const body = {
      date: '2026-10-18',
      weight: 81.5,
      bodyFat: 19.9,
      muscle: 61.7,
      delta: -0.4,
      trend: [82, 81.5],
      isToday: false,
    };
    expect(mount(BodyCard, { props: { body } }).text()).toContain('Último pesaje: 18/10');
    const banner = mount(PeriodBanner, {
      props: { period: { type: 'away', from: '2026-11-01', to: '2026-11-04', phase: 'during' } },
    }).text();
    expect(banner).toContain('Fuera de casa · del 1 al 4 de noviembre');
  });
});
