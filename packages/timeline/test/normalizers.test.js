import { describe, it, expect } from 'vitest';
import {
  normalizeGoogleDay,
  normalizeMeal,
  normalizeEntry,
  normalizeXiaomiScale,
  normalizeIntervalsActivity,
  normalizeIntervalsWellness,
  normalizeMotraWorkout,
  normalizeClinical,
  clinicalPeriod,
  normalizerFor,
  localMidnight,
  splitDays,
  METRICS,
  GOOGLE_MEASURES,
} from '../src/index.js';
import { appleDeviceShares } from '../src/normalizers/google.js';

const apple = {
  recordingMethod: 'PASSIVELY_MEASURED',
  device: { manufacturer: 'Apple Inc.' },
  application: { packageName: 'com.apple.health.29549FF7-08E8-4B4B-8B8C-EFB15CB8161D' },
  platform: 'HEALTH_KIT',
};

const xiaomiItem = {
  did: 'blt.3.abc',
  model: 'yunmai.scales.ms104',
  createTime: 1760331978,
  fromSource: 1,
  data: JSON.stringify({ weight: 82.4, bfp: 18.2, bmi: 24.1, heartRate: 61, reportFrom: 'scale' }),
};

describe('catálogo', () => {
  it('códigos únicos y todas las métricas de Google existen', () => {
    const codes = METRICS.map((m) => m.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const measures of Object.values(GOOGLE_MEASURES)) {
      for (const [code] of measures) expect(codes).toContain(code);
    }
  });
});

describe('Xiaomi', () => {
  it('un pesaje: episodio con la composición y una observación por métrica', () => {
    const result = normalizeXiaomiScale(xiaomiItem);
    expect(result.mode).toBe('exact');
    expect(result.observations.map((o) => [o.metric, o.value])).toEqual([
      ['body.weight', 82.4],
      ['body.bmi', 24.1],
      ['body.fat_percent', 18.2],
      ['heart.rate', 61],
    ]);
    expect(result.observations[0]).toMatchObject({
      origin: 'yunmai.scales.ms104:blt.3.abc',
      time: '2025-10-13T05:06:18.000Z',
    });
    expect(result.episodes).toMatchObject([
      {
        kind: 'weigh-in',
        externalId: 'blt.3.abc:1760331978',
        summary: { weight: 82.4, bodyFat: 18.2 },
        schema: 'weigh-in@1',
      },
    ]);
  });
});

describe('Google', () => {
  const day = { from: '2026-10-08T00:00:00.000Z', to: '2026-10-09T00:00:00.000Z' };

  it('muestras con valores en texto y origen por app/dispositivo', () => {
    const result = normalizeGoogleDay(
      {
        ...day,
        dataType: 'heart-rate',
        points: [
          {
            dataSource: apple,
            heartRate: {
              sampleTime: { physicalTime: '2026-10-08T11:31:45.764Z' },
              beatsPerMinute: '67',
            },
          },
        ],
      },
      { timeZone: 'Europe/Madrid' },
    );
    expect(result).toMatchObject({ mode: 'range', metrics: ['heart.rate'] });
    expect(result.observations).toEqual([
      expect.objectContaining({
        metric: 'heart.rate',
        value: 67,
        time: '2026-10-08T11:31:45.764Z',
        origin: 'HEALTH_KIT|com.apple.health',
      }),
    ]);
  });

  it('intervalos con conversión de unidades (mm → m)', () => {
    const { observations } = normalizeGoogleDay(
      {
        ...day,
        dataType: 'distance',
        points: [
          {
            dataSource: apple,
            distance: {
              interval: { startTime: '2026-10-08T11:30:40Z', endTime: '2026-10-08T11:40:41Z' },
              millimeters: '113636',
            },
          },
        ],
      },
      { timeZone: 'Europe/Madrid' },
    );
    expect(observations[0]).toMatchObject({
      metric: 'activity.distance',
      value: 113.636,
      end: '2026-10-08T11:40:41Z',
    });
  });

  it('diarios a medianoche local', () => {
    const { observations } = normalizeGoogleDay(
      {
        ...day,
        dataType: 'daily-resting-heart-rate',
        points: [
          {
            dataSource: apple,
            dailyRestingHeartRate: {
              date: { year: 2026, month: 10, day: 8 },
              beatsPerMinute: '53',
            },
          },
        ],
      },
      { timeZone: 'Europe/Madrid' },
    );
    expect(observations[0]).toMatchObject({
      metric: 'heart.resting_rate',
      value: 53,
      time: '2026-10-07T22:00:00.000Z',
    });
  });

  it('los diarios borran solo su día local, no el día UTC', () => {
    const result = normalizeGoogleDay(
      {
        dataType: 'daily-resting-heart-rate',
        from: '2026-10-08T00:00:00.000Z',
        to: '2026-10-09T00:00:00.000Z',
        points: [],
      },
      { timeZone: 'Europe/Madrid' },
    );
    expect(result.range).toEqual({
      from: '2026-10-07T22:00:00.000Z',
      to: '2026-10-08T22:00:00.000Z',
    });
  });

  it('RMSSD a 0 (Apple solo mide SDNN) no se guarda', () => {
    const { observations } = normalizeGoogleDay(
      {
        ...day,
        dataType: 'heart-rate-variability',
        points: [
          {
            dataSource: apple,
            heartRateVariability: {
              sampleTime: { physicalTime: '2026-10-08T00:10:59Z' },
              standardDeviationMilliseconds: 40.5,
              rootMeanSquareOfSuccessiveDifferencesMilliseconds: 0,
            },
          },
        ],
      },
      { timeZone: 'Europe/Madrid' },
    );
    expect(observations.map((o) => o.metric)).toEqual(['heart.hrv_sdnn']);
  });

  it('entreno y sueño como episodios con su extensión', () => {
    const workout = normalizeGoogleDay(
      {
        ...day,
        dataType: 'exercise',
        points: [
          {
            name: 'users/1/dataTypes/exercise/dataPoints/2992',
            dataSource: { ...apple, application: { packageName: 'com.trainfitness.Train' } },
            exercise: {
              interval: { startTime: '2026-10-08T11:45:37Z', endTime: '2026-10-08T12:40:46Z' },
              exerciseType: 'STRENGTH_TRAINING',
              metricsSummary: { caloriesKcal: 252 },
              displayName: 'Fortalecimiento muscular',
              activeDuration: '3309.22s',
            },
          },
        ],
      },
      { timeZone: 'Europe/Madrid' },
    );
    expect(workout.episodes[0]).toMatchObject({
      kind: 'workout',
      externalId: 'users/1/dataTypes/exercise/dataPoints/2992',
      title: 'Fortalecimiento muscular',
      summary: { type: 'STRENGTH_TRAINING', kcal: 252, durationS: 3309.22 },
    });

    const night = normalizeGoogleDay(
      {
        ...day,
        dataType: 'sleep',
        points: [
          {
            name: 's1',
            dataSource: apple,
            sleep: {
              interval: { startTime: '2026-10-07T22:00:00Z', endTime: '2026-10-08T06:00:00Z' },
              stages: [
                {
                  startTime: '2026-10-07T22:00:00Z',
                  endTime: '2026-10-08T05:30:00Z',
                  type: 'LIGHT',
                },
                {
                  startTime: '2026-10-08T05:30:00Z',
                  endTime: '2026-10-08T06:00:00Z',
                  type: 'AWAKE',
                },
              ],
            },
          },
        ],
      },
      { timeZone: 'Europe/Madrid' },
    );
    expect(night.episodes[0].summary).toEqual({
      type: null,
      asleepMinutes: 450,
      stages: { light: 450, awake: 30 },
    });
  });

  it('los tipos sin normalizador se quedan en crudo', () => {
    expect(normalizerFor('google-health', 'sedentary-period')).toBeNull();
    expect(normalizerFor('google-health', 'steps')).toBe(normalizeGoogleDay);
    expect(normalizerFor('strava', 'activity')).toBeNull();
  });
});

describe('Google: Apple Watch e iPhone', () => {
  const day = { from: '2026-10-19T00:00:00.000Z', to: '2026-10-20T00:00:00.000Z' };
  // Desde el 17/10/2026 Google ya no manda el UUID del aparato; el iPhone va con formFactor
  const watch = { ...apple, application: { packageName: 'com.apple.health' } };
  const phone = { ...watch, device: { manufacturer: 'Apple Inc.', formFactor: 'PHONE' } };
  const steps = (dataSource, start, end, count) => ({
    dataSource,
    steps: { interval: { startTime: start, endTime: end }, count: String(count) },
  });
  const normalize = (points) =>
    normalizeGoogleDay({ ...day, dataType: 'steps', points }, { timeZone: 'Europe/Madrid' })
      .observations;

  it('el formato viejo (con UUID) y el nuevo son el mismo origen', () => {
    const [a, b] = normalize([
      steps(apple, '2026-10-19T08:00:00Z', '2026-10-19T08:01:00Z', 10),
      steps(watch, '2026-10-19T09:00:00Z', '2026-10-19T09:01:00Z', 10),
    ]);
    expect(a.origin).toBe('HEALTH_KIT|com.apple.health');
    expect(b.origin).toBe(a.origin);
  });

  it('manda el reloj; el iPhone solo cuenta donde el reloj no mide (en proporción)', () => {
    const obs = normalize([
      steps(watch, '2026-10-19T08:00:00Z', '2026-10-19T08:10:00Z', 1000),
      // Lo mismo, medido también por el iPhone: no cuenta
      steps(phone, '2026-10-19T08:00:00Z', '2026-10-19T08:10:00Z', 950),
      // El iPhone sigue media hora más que el reloj: cuenta la parte sin reloj
      steps(watch, '2026-10-19T09:00:00Z', '2026-10-19T09:10:00Z', 500),
      steps(phone, '2026-10-19T09:00:00Z', '2026-10-19T09:40:00Z', 800),
      // Un rato largo sin reloj (en la mesilla): cuenta entero
      steps(phone, '2026-10-19T12:00:00Z', '2026-10-19T12:20:00Z', 2000),
    ]);
    const total = obs.reduce((a, o) => a + o.value, 0);
    // 1000 + 500 + 800 × 30/40 + 2000 (el margen solo une huecos entre dos muestras del reloj)
    expect(total).toBe(1000 + 500 + 600 + 2000);
    expect(obs).toHaveLength(4);
  });

  it('los huecos cortos entre muestras del reloj cuentan como medidos por el reloj', () => {
    const points = [
      steps(watch, '2026-10-19T08:00:00Z', '2026-10-19T08:05:00Z', 300),
      steps(phone, '2026-10-19T08:05:00Z', '2026-10-19T08:15:00Z', 400),
      steps(watch, '2026-10-19T08:15:00Z', '2026-10-19T08:20:00Z', 300),
    ];
    expect(appleDeviceShares('steps', points).get(points[1])).toBe(0);
    expect(normalize(points).reduce((a, o) => a + o.value, 0)).toBe(600);
  });

  it('sin reloj ese día, todo lo del iPhone', () => {
    const obs = normalize([steps(phone, '2026-10-19T08:00:00Z', '2026-10-19T08:10:00Z', 900)]);
    expect(obs.map((o) => o.value)).toEqual([900]);
  });

  it('otras apps que pasan por Apple Health (Garmin) no se tocan', () => {
    const garmin = { ...watch, application: { packageName: 'com.garmin.connect.mobile' } };
    const obs = normalize([
      steps(watch, '2026-10-19T08:00:00Z', '2026-10-19T08:10:00Z', 1000),
      steps(garmin, '2026-10-19T08:00:00Z', '2026-10-19T08:10:00Z', 990),
    ]);
    expect(obs.map((o) => [o.origin, o.value])).toEqual([
      ['HEALTH_KIT|com.apple.health', 1000],
      ['HEALTH_KIT|com.garmin.connect.mobile|Apple Inc.|', 990],
    ]);
  });
});

describe('comidas del bot', () => {
  it('un episodio por plato y las macros sumadas por hora', () => {
    const item = (kcal) => ({
      name: 'x',
      quantity: 1,
      unit: 'u',
      kcal,
      proteinG: 10,
      carbsG: 20,
      fatG: 5,
      fiberG: 1,
    });
    const result = normalizeMeal({
      id: '7a1d1a51-6b0e-4a43-9a3b-1b6bb1e7a001',
      source: 'telegram',
      text: 'tostada y café',
      notes: '',
      dishes: [
        { name: 'Tostada', eatenAt: '2026-10-15T07:00:00Z', items: [item(200)] },
        { name: 'Café', eatenAt: '2026-10-15T07:00:00Z', items: [item(50)] },
      ],
      createdAt: '2026-10-15T07:05:00Z',
    });
    expect(result.episodes.map((e) => [e.externalId, e.title, e.summary.kcal])).toEqual([
      ['7a1d1a51-6b0e-4a43-9a3b-1b6bb1e7a001:0', 'Tostada', 200],
      ['7a1d1a51-6b0e-4a43-9a3b-1b6bb1e7a001:1', 'Café', 50],
    ]);
    expect(result.observations.find((o) => o.metric === 'intake.energy')).toMatchObject({
      value: 250,
      origin: 'telegram',
    });
  });

  it('las bebidas suman lo que hidratan y su cafeína; la comida sólida y el alcohol, nada', () => {
    const item = (extra) => ({
      name: 'x',
      quantity: 1,
      unit: 'u',
      kcal: 50,
      proteinG: 1,
      carbsG: 5,
      fatG: 1,
      fiberG: 0,
      ...extra,
    });
    const at = '2026-10-15T07:00:00Z';
    const result = normalizeMeal({
      id: '7a1d1a51-6b0e-4a43-9a3b-1b6bb1e7a002',
      source: 'telegram',
      text: 'café con leche, tostada y una cerveza',
      notes: '',
      dishes: [
        { name: 'Café con leche', eatenAt: at, items: [item({ fluidMl: 200, caffeineMg: 80 })] },
        { name: 'Tostada', eatenAt: at, items: [item()] },
        { name: 'Cerveza', eatenAt: at, items: [item()] },
      ],
      createdAt: at,
    });
    const value = (metric) => result.observations.find((o) => o.metric === metric)?.value;
    expect(value('intake.beverages')).toBe(200);
    expect(value('intake.caffeine')).toBe(80);
    expect(result.episodes[0].summary).toMatchObject({ fluidMl: 200, caffeineMg: 80 });
    expect(result.episodes[1].summary.fluidMl).toBeUndefined();
  });

  it('el tipo de comida de cada plato va al resumen (las antiguas, sin él)', () => {
    const at = '2026-10-15T17:30:00Z';
    const item = {
      name: 'x',
      quantity: 1,
      unit: '',
      kcal: 100,
      proteinG: 1,
      carbsG: 1,
      fatG: 1,
      fiberG: 0,
    };
    const result = normalizeMeal({
      id: '7a1d1a51-6b0e-4a43-9a3b-1b6bb1e7a003',
      source: 'telegram',
      text: 'puré para cenar y luego un yogur',
      notes: '',
      dishes: [
        { name: 'Puré', eatenAt: at, mealType: 'dinner', items: [item] },
        { name: 'Yogur', eatenAt: at, items: [item] },
      ],
      createdAt: at,
    });
    expect(result.episodes[0].summary.mealType).toBe('dinner');
    expect(result.episodes[1].summary).not.toHaveProperty('mealType');
  });
});

describe('registros de bebidas', () => {
  const at = '2026-10-15T07:00:00Z';
  const metrics = (r) => r.observations.map((o) => [o.metric, o.value]);

  it('una bebida de Registrar: lo que hidrata como otras bebidas, y su cafeína', () => {
    const r = normalizeEntry({
      id: 'd1',
      kind: 'drink',
      at,
      text: 'Café con leche',
      value: 200,
      caffeineMg: 80,
    });
    expect(metrics(r)).toEqual([
      ['intake.beverages', 200],
      ['intake.caffeine', 80],
    ]);
    expect(r.episodes[0]).toMatchObject({
      kind: 'drink',
      title: 'Café con leche',
      summary: { fluidMl: 200, caffeineMg: 80 },
    });
  });

  it('sin cafeína (una infusión) no apunta cafeína; el agua sigue siendo agua', () => {
    const tea = normalizeEntry({ id: 'd2', kind: 'drink', at, text: 'Infusión', value: 250 });
    expect(metrics(tea)).toEqual([['intake.beverages', 250]]);
    expect(tea.episodes[0].summary).toEqual({ fluidMl: 250 });
    const water = normalizeEntry({ id: 'w1', kind: 'water', at, value: 500 });
    expect(metrics(water)).toEqual([['intake.water', 500]]);
  });

  it('los cafés de antes (solo mg de cafeína) siguen igual', () => {
    const old = normalizeEntry({ id: 'c1', kind: 'coffee', at, value: 80 });
    expect(metrics(old)).toEqual([['intake.caffeine', 80]]);
  });
});

describe('fechas', () => {
  it('medianoche local con cambio de hora', () => {
    expect(localMidnight('2026-03-29', 'Europe/Madrid').toISOString()).toBe(
      '2026-03-28T23:00:00.000Z',
    );
    expect(localMidnight('2026-03-30', 'Europe/Madrid').toISOString()).toBe(
      '2026-03-29T22:00:00.000Z',
    );
  });

  it('parte en días UTC, de más reciente a más antiguo', () => {
    const days = splitDays('2026-10-01T10:00:00Z', '2026-10-03T00:00:00Z', { newestFirst: true });
    expect(days.map((d) => d.from.toISOString().slice(0, 10))).toEqual([
      '2026-10-02',
      '2026-10-01',
    ]);
  });
});

describe('intervals.icu', () => {
  it('actividad → entreno con su TSS', () => {
    const result = normalizeIntervalsActivity({
      id: 'i9',
      name: 'Clase de ciclo',
      type: 'VirtualRide',
      source: 'GARMIN_CONNECT',
      start_date: '2026-10-14T12:15:00Z',
      elapsed_time: 2700,
      moving_time: 2640,
      icu_training_load: 52,
      average_heartrate: 138,
      calories: 520,
    });
    expect(result.mode).toBe('exact');
    expect(result.episodes[0]).toMatchObject({
      kind: 'workout',
      externalId: 'i9',
      origin: 'garmin_connect',
      end: '2026-10-14T13:00:00.000Z',
      summary: { type: 'VirtualRide', tss: 52, avgHeartRate: 138, durationS: 2640 },
    });
    expect(result.observations).toEqual([
      expect.objectContaining({ metric: 'training.load', value: 52 }),
    ]);
  });

  it('wellness → solo CTL, ATL y rampa, a medianoche local y con su día como rango', () => {
    const result = normalizeIntervalsWellness(
      { id: '2026-10-14', ctl: 41.2, atl: 55.8, rampRate: 3.1, restingHR: 48, hrv: 60 },
      { timeZone: 'Europe/Madrid' },
    );
    expect(result.observations.map((o) => [o.metric, o.value, o.time])).toEqual([
      ['training.ctl', 41.2, '2026-10-13T22:00:00.000Z'],
      ['training.atl', 55.8, '2026-10-13T22:00:00.000Z'],
      ['training.ramp', 3.1, '2026-10-13T22:00:00.000Z'],
    ]);
    expect(result.range).toEqual({
      from: '2026-10-13T22:00:00.000Z',
      to: '2026-10-14T22:00:00.000Z',
    });
  });
});

describe('Motra', () => {
  it('entreno → episodio de fuerza con series, reps, peso y volumen', () => {
    const result = normalizeMotraWorkout({
      workoutID: 'W1',
      name: 'Viernes de pecho',
      activityType: 'traditionalStrengthTraining',
      workoutFormat: 'trainStrength',
      timeStarted: 1791545489,
      timeEnded: 1791547855,
      statistics: { calories: 186 },
      activities: [
        { segment: 'main', strengthExercise: { exercises: [{ setIDs: ['s1', 's2'] }] } },
      ],
      setMap: {
        s1: {
          setID: 's1',
          exerciseTypeID: 'barbellBenchPress',
          restTime: 120,
          measurements: { reps: 5, time: 30, weight: { value: 60, unit: 'kg' } },
        },
        s2: {
          setID: 's2',
          exerciseTypeID: 'barbellBenchPress',
          restTime: 125,
          measurements: { reps: 4, weight: { value: 60, unit: 'kg' } },
        },
      },
      exerciseDetails: {
        barbellBenchPress: {
          name: 'Barbell Bench Press',
          primaryMuscleGroups: ['chest'],
          secondaryMuscleGroups: ['triceps'],
          equipmentGroups: ['barbell'],
        },
      },
    });

    expect(result.mode).toBe('exact');
    const ep = result.episodes[0];
    expect(ep).toMatchObject({
      kind: 'workout',
      externalId: 'W1',
      origin: 'motra',
      title: 'Viernes de pecho',
      schema: 'motra.workout@1',
      start: '2026-10-09T11:31:29.000Z',
    });
    // 5·60 + 4·60 = 540
    expect(ep.summary).toMatchObject({
      type: 'traditionalStrengthTraining',
      exerciseCount: 1,
      setCount: 2,
      totalReps: 9,
      volumeKg: 540,
      kcal: 186,
      muscleGroups: ['chest'],
    });
    expect(ep.details.exercises[0]).toMatchObject({
      name: 'Barbell Bench Press',
      primaryMuscleGroups: ['chest'],
    });
    expect(ep.details.exercises[0].sets).toHaveLength(2);
    expect(ep.details.exercises[0].sets[0]).toMatchObject({ reps: 5, weightKg: 60, restS: 120 });
  });

  it('pesos en libras pasan a kg; series por tiempo sin reps no suman volumen', () => {
    const ep = normalizeMotraWorkout({
      workoutID: 'W2',
      timeStarted: 1791545489,
      activities: [{ strengthExercise: { exercises: [{ setIDs: ['a', 'b'] }] } }],
      setMap: {
        a: {
          exerciseTypeID: 'curl',
          measurements: { reps: 10, weight: { value: 50, unit: 'lb' } },
        },
        b: { exerciseTypeID: 'curl', measurements: { time: 45, weight: { value: 0, unit: 'kg' } } },
      },
    }).episodes[0];
    expect(ep.details.exercises[0].sets.map((s) => [s.reps, s.weightKg, s.timeS])).toEqual([
      [10, 22.68, null],
      [null, 0, 45],
    ]);
    expect(ep.summary).toMatchObject({ setCount: 2, totalReps: 10, volumeKg: 227 });
    // En el resumen, una línea por ejercicio: reps, peso máximo y segundos de las series por tiempo
    expect(ep.summary.exercises).toEqual([
      { name: 'curl', sets: 2, reps: 10, topKg: 22.68, seconds: 45 },
    ]);
  });

  it('entreno sin fecha válida → vacío', () => {
    expect(normalizeMotraWorkout({ workoutID: 'x' }).episodes).toEqual([]);
    expect(normalizeMotraWorkout(null).episodes).toEqual([]);
  });

  it('normalizerFor enruta motra/workout', () => {
    expect(normalizerFor('motra', 'workout')).toBe(normalizeMotraWorkout);
  });
});

describe('informes clínicos', () => {
  const item = (over) => ({
    id: 'i1',
    section: 'Bioquímica',
    name: 'Creatinina',
    text: '1.41',
    value: 1.41,
    unit: 'mg/dl',
    rangeText: '(0.6 - 1.3)',
    rangeMin: 0.6,
    rangeMax: 1.3,
    flag: 'high',
    comment: '',
    metric: 'lab.creatinine',
    metricValue: 1.41,
    metricUnit: 'mg/dL',
    skip: false,
    key: null,
    issues: [],
    ...over,
  });
  const lab = {
    type: 'lab',
    title: 'Analítica',
    center: 'Laboratorio X',
    date: '2026-10-07',
    start: null,
    end: null,
    summary: '',
    items: [
      item(),
      item({
        id: 'i2',
        name: 'Antígeno raro',
        flag: null,
        metric: null,
        metricValue: 12,
        metricUnit: 'U/mL',
        issues: ['unknown'],
      }),
      item({
        id: 'i3',
        name: 'HBsAg',
        text: 'Negativo',
        value: null,
        metric: null,
        metricValue: null,
        flag: null,
      }),
      item({
        id: 'i4',
        name: 'Glucosa',
        metric: 'lab.glucose',
        metricValue: null,
        issues: ['unit'],
        flag: null,
      }),
      item({ id: 'i5', name: 'Urea', metric: 'lab.urea', metricValue: 32, skip: true, flag: null }),
    ],
    hourly: [],
    issues: [],
  };

  it('una analítica: episodio a las 08:00 de su día y una observación por valor numérico', () => {
    expect(normalizerFor('clinical', 'lab')).toBe(normalizeClinical);
    const result = normalizeClinical(
      { documentId: 'doc-1', fileName: 'a.pdf', extraction: lab },
      { timeZone: 'Europe/Madrid' },
    );
    const time = '2026-10-07T06:00:00.000Z';
    expect(result.mode).toBe('exact');
    expect(result.observations).toEqual([
      expect.objectContaining({
        metric: 'lab.creatinine',
        time,
        value: 1.41,
        origin: 'clinical:lab',
      }),
      expect.objectContaining({ metric: 'lab.custom.antigeno_raro', time, value: 12 }),
    ]);
    expect(result.newMetrics).toEqual({
      'lab.custom.antigeno_raro': { unit: 'U/mL', aggregation: 'last', label: 'Antígeno raro' },
    });
    const [episode] = result.episodes;
    expect(episode).toMatchObject({
      kind: 'lab',
      externalId: 'doc-1',
      start: time,
      end: null,
      title: 'Analítica',
      schema: 'clinical@1',
      summary: {
        documentId: 'doc-1',
        items: 5,
        flagged: 1,
        flaggedItems: [{ name: 'Creatinina', flag: 'high' }],
      },
    });
    expect(episode.details.items.map((i) => i.metric)).toEqual([
      'lab.creatinine',
      'lab.custom.antigeno_raro',
      null,
      'lab.glucose',
      null,
    ]);
  });

  it('un holter: sus medidas al inicio y la tabla por horas como pulso', () => {
    const holter = {
      ...lab,
      type: 'holter',
      title: 'Holter',
      date: '2026-09-30',
      start: '2026-09-30T13:30',
      end: '2026-10-01T12:35',
      items: [
        item({
          name: 'FC media',
          key: 'hr_avg',
          text: '63',
          value: 63,
          metric: 'holter.hr_avg',
          metricValue: 63,
          flag: null,
        }),
      ],
      hourly: [
        {
          start: '2026-09-30T13:30',
          end: '2026-09-30T14:00',
          hrMin: 50,
          hrAvg: 67,
          hrMax: 105,
          verified: true,
        },
      ],
    };
    const result = normalizeClinical(
      { documentId: 'doc-2', fileName: 'h.pdf', extraction: holter },
      { timeZone: 'Europe/Madrid' },
    );
    expect(result.observations).toEqual([
      expect.objectContaining({
        metric: 'holter.hr_avg',
        time: '2026-09-30T11:30:00.000Z',
        value: 63,
      }),
      expect.objectContaining({
        metric: 'heart.rate',
        time: '2026-09-30T11:30:00.000Z',
        end: '2026-09-30T12:00:00.000Z',
        value: 67,
      }),
    ]);
    expect(result.episodes[0]).toMatchObject({
      kind: 'holter',
      end: '2026-10-01T10:35:00.000Z',
      summary: { measures: { hr_avg: 63 } },
    });
    expect(clinicalPeriod(holter, 'Europe/Madrid').start.toISOString()).toBe(
      '2026-09-30T11:30:00.000Z',
    );
  });
});
