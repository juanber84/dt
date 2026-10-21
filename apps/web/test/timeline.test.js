import { describe, expect, it } from 'vitest';
import {
  activityFrom,
  byDay,
  dailyValues,
  mealEvent,
  mergeDay,
  mergeSummary,
  realTotals,
  sleepFrom,
  workoutEvent,
  emptySummary,
  entryEvent,
} from '../src/services/timeline.js';

const local = (h, m = 0, d = 6) => new Date(2026, 9, d, h, m).toISOString();

const meal = {
  id: 'm1',
  kind: 'meal',
  start: local(15),
  title: 'Arroz con verduras y pollo',
  summary: { kcal: 343.4, proteinG: 20.2, carbsG: 46.2, fatG: 9.5 },
  details: {
    entryId: 'e1',
    text: 'arroz con pollo',
    items: [{ name: 'Arroz', kcal: 180 }],
    createdAt: '2026-10-06T20:00:00.000Z',
  },
  provider: 'digitaltwin',
  origin: { channel: 'telegram' },
};
const weighIn = {
  id: 'w1',
  kind: 'weigh-in',
  start: local(7, 10),
  summary: { weight: 82, bodyFat: 20.4 },
  details: { weight: 82, bodyFat: 20.4, muscleMass: 61.5, bodyWater: 62, profile: {}, user: 'x' },
  provider: 'xiaomi',
  origin: {},
};
const workout = {
  id: 'x1',
  kind: 'workout',
  start: local(13, 38),
  end: local(14, 34),
  title: 'Ciclismo',
  summary: { type: 'BIKING', durationS: 3383, distanceM: 28562, kcal: 679, avgHeartRate: 131 },
  provider: 'google-health',
  origin: {},
};
const sleep = {
  id: 's1',
  kind: 'sleep',
  start: local(23, 50, 5),
  end: local(6, 50),
  summary: { asleepMinutes: 360 },
  details: {
    stages: [
      { type: 'LIGHT', startTime: local(23, 50, 5), endTime: local(2) },
      { type: 'DEEP', startTime: local(2), endTime: local(3) },
      { type: 'AWAKE', startTime: local(3), endTime: local(3, 10) },
      { type: 'REM', startTime: local(3, 10), endTime: local(6, 50) },
    ],
  },
  provider: 'google-health',
  origin: {},
};

describe('timeline real', () => {
  it('comida → evento del timeline', () => {
    expect(mealEvent(meal)).toMatchObject({
      category: 'nutrition',
      start: 900,
      macros: { kcal: 343, protein: 20.2 },
      sources: [{ source: 'telegram', externalId: 'e1', primary: true }],
    });
  });

  it('entreno → evento con icono por tipo y fin', () => {
    expect(workoutEvent(workout)).toMatchObject({
      category: 'activity',
      icon: 'Bike',
      start: 818,
      end: 874,
      subtitle: '56m · 28,6 km · 131 ppm',
    });
  });

  it('sueño: fases en minutos desde la medianoche (negativos la víspera) y totales', () => {
    const { totals, detail } = sleepFrom('2026-10-06', sleep);
    expect(detail.stages[0]).toEqual({ stage: 'light', start: -10, end: 120 });
    expect(totals).toMatchObject({ light: 130, deep: 60, rem: 220, awake: 10, minutes: 410 });
    expect(totals.efficiency).toBe(98);
    expect(sleepFrom('2026-10-06', null).detail.stages).toEqual([]);
  });

  it('episodios por día: el sueño cuenta para el día en que acaba', () => {
    const days = byDay([sleep, weighIn, meal, workout]);
    expect([...days.keys()]).toEqual(['2026-10-06']);
    expect(days.get('2026-10-06')).toMatchObject({ sleep: { id: 's1' } });
  });

  it('series diarias → valores por día', () => {
    const daily = dailyValues({
      'activity.steps': { points: [{ t: local(0), value: 9426 }] },
      'activity.distance': { points: [{ t: local(0), value: 6771 }] },
      'heart.resting_rate': { points: [{ t: local(0), value: 50 }] },
    });
    expect(daily.get('2026-10-06')).toEqual({ steps: 9426, distanceKm: 6.8, rhr: 50 });
  });

  it('totales: suma comidas y coge el último pesaje', () => {
    expect(
      realTotals({
        meals: [meal, { ...meal, summary: { kcal: 76, proteinG: 2.6 } }],
        weighIns: [weighIn],
      }),
    ).toEqual({
      nutrition: { kcal: 419, protein: 22.8, carbs: 46.2, fat: 9.5 },
      weight: 82,
      bodyFat: 20.4,
      muscle: 61.5,
    });
  });

  it('carga con CTL/ATL de intervals.icu; sin ellos no hay carga (nada inventado)', () => {
    const empty = emptySummary('2026-10-14');
    const real = mergeSummary(empty, undefined, { tss: 55, ctl: 26.4, atl: 43.7 });
    expect(real.load).toEqual({ tss: 55, ctl: 26.4, atl: 43.7, tsb: -17.3 });
    const none = mergeSummary(empty);
    expect(none.load).toBeNull();
  });

  it('un día vacío no tiene ningún número: ni recuperación, ni sueño, ni agua, ni objetivo de kcal', () => {
    const summary = mergeSummary(emptySummary('2026-10-06'));
    const numbers = [];
    const walk = (value, path) => {
      if (typeof value === 'number') numbers.push(path);
      else if (value && typeof value === 'object')
        for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
    };
    walk(summary, 'día');
    // Solo los objetivos por defecto (proteína, agua) y lo que necesitas dormir
    expect(numbers.sort()).toEqual([
      'día.nutrition.proteinTarget',
      'día.nutrition.waterTargetMl',
      'día.sleep.need',
    ]);
  });

  it('el agua sale de intake.water y el objetivo de kcal es lo gastado ese día', () => {
    const summary = mergeSummary(emptySummary('2026-10-06'), undefined, {
      waterMl: 1750,
      activeKcal: 600,
      basalKcal: 1750,
    });
    expect(summary.nutrition).toMatchObject({ waterMl: 1750, target: 2350 });
  });

  it('un día sin datos queda sin dato (no a 0) para que las medias no se hundan', () => {
    const summary = mergeSummary(emptySummary('2026-10-06'));
    expect(summary).toMatchObject({
      hrv: null,
      rhr: null,
      steps: null,
      weight: null,
      recovery: null,
      totalKcal: null,
    });
    expect(summary.sleep.minutes).toBeNull();
    expect(summary.nutrition.kcal).toBeNull();
  });

  it('en la vista del día, lo que falta sigue en null (no son 0 pasos ni 0 kcal)', () => {
    const day = mergeDay(emptySummary('2026-10-06'), {
      episodes: new Map(),
      daily: new Map(),
      stepsByHour: Array(24).fill(0),
      hr: [],
    });
    expect(day).toMatchObject({ steps: null, activeKcal: null, floors: null, recovery: null });
    // Sin noche registrada no hay sueño de 0 minutos con puntuación 0: no hay sueño
    expect(day.sleep).toMatchObject({ minutes: null, score: null, efficiency: null });
    expect(day.nutrition).toMatchObject({ kcal: null, protein: null });
    expect(day.events).toEqual([]);
  });

  it('gasto total = activa + basal, solo si están las dos', () => {
    expect(
      mergeSummary(emptySummary('2026-10-06'), undefined, { activeKcal: 600, basalKcal: 1750 }),
    ).toMatchObject({ totalKcal: 2350 });
    expect(
      mergeSummary(emptySummary('2026-10-06'), undefined, { activeKcal: 600 }).totalKcal,
    ).toBeNull();
  });

  it('el día lleva los episodios reales como eventos', () => {
    const merged = mergeDay(emptySummary('2026-10-06'), {
      episodes: byDay([sleep, weighIn, meal, workout]),
      daily: new Map([['2026-10-06', { hrv: 51, rhr: 50, steps: 9426 }]]),
      stepsByHour: Array(24).fill(10),
      hr: [{ t: 600, bpm: 70 }],
    });
    expect(merged.events.map((e) => e.id)).toEqual(['s1', 'w1', 'x1', 'm1']);
    expect(merged).toMatchObject({ hrv: 51, rhr: 50, steps: 9426, weight: 82 });
    expect(merged.nutrition.kcal).toBe(343);
    // Sin gasto (activas + basal) ese día no hay objetivo de kcal
    expect(merged.nutrition.target).toBeNull();
    expect(merged.sleepDetail.stages).toHaveLength(4);
    expect(merged.hr).toEqual([{ t: 600, bpm: 70 }]);
  });
});

describe('entrenos reales en la lista de Entrenos', () => {
  it('mismo id que su evento del día, deporte y ritmo', () => {
    const run = {
      id: 'ep-9',
      kind: 'workout',
      title: 'Carrera suave',
      start: new Date(2026, 9, 12, 7, 30).toISOString(),
      end: new Date(2026, 9, 12, 8, 20).toISOString(),
      summary: { type: 'Run', durationS: 3000, distanceM: 10000, avgHeartRate: 141.6, tss: 52.4 },
    };
    expect(activityFrom(run)).toMatchObject({
      id: 'ep-9',
      date: '2026-10-12',
      sportLabel: 'Carrera',
      icon: 'Footprints',
      minutes: 50,
      distanceKm: 10,
      paceSecPerKm: 300,
      avgHr: 142,
      tss: 52,
    });
    expect(activityFrom(run).id).toBe(workoutEvent(run).id);
  });
});

describe('registros a mano', () => {
  const ep = (kind, summary, extra = {}) => ({
    id: `ep-${kind}`,
    kind,
    externalId: `entry-${kind}`,
    start: '2026-10-21T08:30:00Z',
    title: extra.title ?? kind,
    summary,
    details: { text: extra.text ?? '' },
    origin: { channel: 'manual' },
  });

  it('agua, síntoma y nota: su evento, borrables por su id de registro', () => {
    expect(entryEvent(ep('drink', { waterMl: 500 }))).toMatchObject({
      category: 'hydration',
      title: 'Agua',
      subtitle: '500 ml',
      entryId: 'entry-drink',
    });
    expect(entryEvent(ep('symptom', { intensity: 3 }, { title: 'Mocos' }))).toMatchObject({
      category: 'note',
      title: 'Mocos',
      subtitle: 'Síntoma · intensidad 3/5',
    });
    expect(entryEvent(ep('note', {}, { title: 'Me noto cansado' }))).toMatchObject({
      title: 'Nota',
      subtitle: 'Me noto cansado',
    });
  });

  it('van a su día con el resto', () => {
    const days = byDay([ep('drink', { waterMl: 250 }), ep('symptom', { intensity: 2 })]);
    expect(days.get('2026-10-21').entries).toHaveLength(2);
  });
});
