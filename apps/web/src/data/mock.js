/**
 * Datos de ejemplo deterministas: el mismo día da siempre los mismos datos, así que se puede
 * navegar por cualquier fecha. Imitan lo que devolverá la API (registros crudos de varias fuentes
 * con su external_id, uno marcado como principal). Se borra cuando la API tenga los endpoints.
 */
import { seeded, clamp } from '../lib/random.js';
import { addDays, parseISODate, todayISO, minutesOfDay, dateRange } from '../lib/dates.js';

const EPOCH = '2025-01-01';
const dayIndex = (iso) => Math.round((parseISODate(iso) - parseISODate(EPOCH)) / 86_400_000);

// Plan semanal (0 = domingo) con su rango de TSS y duración en minutos
const WEEK_PLAN = [
  { sport: 'ride', title: 'Salida larga', tss: [110, 160], minutes: [150, 210], at: 540 },
  null,
  { sport: 'run', title: 'Rodaje Z2', tss: [45, 65], minutes: [45, 60], at: 450 },
  {
    sport: 'strength',
    title: 'Fuerza · tren inferior',
    tss: [30, 45],
    minutes: [50, 65],
    at: 1140,
  },
  { sport: 'ride', title: 'Intervalos 4×8 min', tss: [75, 100], minutes: [65, 80], at: 450 },
  {
    sport: 'strength',
    title: 'Fuerza · tren superior',
    tss: [25, 40],
    minutes: [45, 60],
    at: 1140,
  },
  { sport: 'run', title: 'Tirada larga', tss: [70, 95], minutes: [70, 95], at: 570 },
];

export const SPORTS = {
  ride: { label: 'Ciclismo', icon: 'Bike' },
  run: { label: 'Carrera', icon: 'Footprints' },
  strength: { label: 'Fuerza', icon: 'Dumbbell' },
  walk: { label: 'Caminata', icon: 'PersonStanding' },
};

function plannedWorkout(iso) {
  const rng = seeded(`workout:${iso}`);
  const plan = WEEK_PLAN[parseISODate(iso).getDay()];
  if (!plan || rng.chance(0.12)) return null;
  const minutes = Math.round(rng.between(...plan.minutes));
  const tss = Math.round(rng.between(...plan.tss));
  const start = plan.at + rng.int(-20, 25);
  const workout = {
    sport: plan.sport,
    title: plan.title,
    start,
    end: start + minutes,
    minutes,
    tss,
    avgHr: Math.round(plan.sport === 'strength' ? rng.between(112, 128) : rng.between(138, 156)),
    kcal: Math.round(minutes * (plan.sport === 'strength' ? 6.5 : rng.between(9, 11.5))),
  };
  workout.maxHr = workout.avgHr + rng.int(18, 32);
  if (plan.sport === 'ride') {
    workout.distanceKm = Math.round(minutes * rng.between(0.46, 0.55) * 10) / 10;
    workout.avgPower = Math.round(rng.between(185, 225));
    workout.normalizedPower = workout.avgPower + rng.int(8, 22);
    workout.elevation = Math.round(workout.distanceKm * rng.between(8, 16));
  }
  if (plan.sport === 'run') {
    workout.distanceKm = Math.round(minutes * rng.between(0.17, 0.2) * 10) / 10;
    workout.paceSecPerKm = Math.round((minutes * 60) / workout.distanceKm);
    workout.elevation = Math.round(workout.distanceKm * rng.between(6, 12));
  }
  if (plan.sport === 'strength') {
    const lower = plan.title.includes('inferior');
    workout.exercises = (
      lower
        ? [
            ['Sentadilla', 4, 6, [90, 105]],
            ['Peso muerto rumano', 3, 8, [80, 95]],
            ['Zancadas', 3, 10, [20, 26]],
            ['Gemelos', 3, 15, [40, 55]],
          ]
        : [
            ['Press banca', 4, 6, [70, 82]],
            ['Dominadas', 4, 8, [0, 10]],
            ['Press militar', 3, 8, [40, 48]],
            ['Remo con barra', 3, 10, [60, 72]],
          ]
    ).map(([name, sets, reps, kg]) => ({
      name,
      sets,
      reps,
      kg: Math.round(rng.between(...kg) / 2.5) * 2.5,
    }));
  }
  workout.zones = zoneSplit(workout, rng);
  return workout;
}

function zoneSplit(workout, rng) {
  const weights =
    workout.sport === 'strength'
      ? [0.35, 0.45, 0.15, 0.05, 0]
      : workout.title.includes('Intervalos')
        ? [0.15, 0.3, 0.15, 0.32, 0.08]
        : [0.1, 0.62, 0.2, 0.07, 0.01];
  const raw = weights.map((w) => w * rng.between(0.8, 1.2));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => Math.round((w / sum) * workout.minutes));
}

// Carga (PMC): CTL 42 días, ATL 7 días. Se calcula desde EPOCH y se cachea.
const pmcCache = [];
function pmc(iso) {
  const target = dayIndex(iso);
  if (target < 0) return { ctl: 40, atl: 40, tsb: 0 };
  for (let i = pmcCache.length; i <= target; i++) {
    const prev = pmcCache[i - 1] ?? { ctl: 48, atl: 50 };
    const tss = plannedWorkout(addDays(EPOCH, i))?.tss ?? 0;
    const ctl = prev.ctl + (tss - prev.ctl) / 42;
    const atl = prev.atl + (tss - prev.atl) / 7;
    pmcCache.push({ ctl, atl, tsb: prev.ctl - prev.atl });
  }
  return pmcCache[target];
}

/** Resumen de un día (barato): lo usan las tendencias. */
export function daySummary(iso) {
  const rng = seeded(`summary:${iso}`);
  const i = dayIndex(iso);
  const load = pmc(iso);
  const workout = plannedWorkout(iso);

  const sleepMinutes = Math.round(clamp(445 + rng.noise() * 32, 330, 530));
  const efficiency = Math.round(clamp(92 + rng.noise() * 2.5, 82, 98));
  const deep = Math.round(sleepMinutes * clamp(0.18 + rng.noise() * 0.02, 0.12, 0.24));
  const rem = Math.round(sleepMinutes * clamp(0.22 + rng.noise() * 0.02, 0.15, 0.28));
  const awake = Math.round((sleepMinutes * (100 - efficiency)) / 100);
  const light = sleepMinutes - deep - rem - awake;
  const sleepScore = Math.round(
    clamp(50 + (sleepMinutes - 360) * 0.2 + (efficiency - 85) * 1.4 + rng.noise() * 3, 40, 99),
  );

  const hrvBaseline = 62 + Math.sin(i / 37) * 3;
  const recovery = Math.round(
    clamp(66 + load.tsb * 1.1 + (sleepScore - 80) * 0.7 + rng.noise() * 7, 14, 99),
  );
  const hrv = Math.round(hrvBaseline * (0.82 + (recovery / 100) * 0.32));
  const rhr = Math.round(clamp(50 + (100 - recovery) / 11 + rng.noise() * 0.8, 44, 66));

  const steps = Math.round(
    clamp(
      8200 +
        rng.noise() * 1900 +
        (workout?.sport === 'run' ? workout.distanceKm * 1250 : 0) +
        (parseISODate(iso).getDay() % 6 === 0 ? 1800 : 0),
      2800,
      26000,
    ),
  );
  const activeKcal = Math.round(steps * 0.042 + (workout?.kcal ?? 0));
  const bmr = 1720;
  const kcalTarget = Math.round((bmr + activeKcal) / 50) * 50;
  const kcal = Math.round(kcalTarget * clamp(0.93 + rng.noise() * 0.06, 0.8, 1.12));

  const weighed = rng.chance(0.82);
  const weight = 79.4 - i * 0.0042 + Math.sin(i / 9) * 0.3 + rng.noise() * 0.18;
  const bodyFat = 15.6 - i * 0.0019 + rng.noise() * 0.25;

  return {
    date: iso,
    recovery,
    hrv,
    hrvBaseline: Math.round(hrvBaseline),
    rhr,
    rhrBaseline: 53,
    spo2: Math.round(clamp(96.6 + rng.noise() * 0.6, 94, 99) * 10) / 10,
    respRate: Math.round(clamp(14.4 + rng.noise() * 0.4, 12.5, 16.5) * 10) / 10,
    skinTemp: Math.round(rng.noise() * 0.18 * 100) / 100,
    sleep: {
      minutes: sleepMinutes,
      deep,
      rem,
      light,
      awake,
      efficiency,
      score: sleepScore,
      need: 480,
    },
    load: { tss: workout?.tss ?? 0, ctl: load.ctl, atl: load.atl, tsb: load.tsb },
    workout,
    steps,
    distanceKm: Math.round(steps * 0.00076 * 10) / 10,
    activeKcal,
    totalKcal: bmr + activeKcal,
    floors: rng.int(4, 18),
    nutrition: {
      kcal,
      target: kcalTarget,
      protein: Math.round((kcal * 0.27) / 4),
      carbs: Math.round((kcal * 0.46) / 4),
      fat: Math.round((kcal * 0.27) / 9),
      proteinTarget: 160,
      waterMl: Math.round(clamp(2300 + rng.noise() * 350, 1400, 3400) / 50) * 50,
      waterTargetMl: 3000,
    },
    weight: weighed ? Math.round(weight * 10) / 10 : null,
    bodyFat: weighed ? Math.round(bodyFat * 10) / 10 : null,
    muscle: weighed ? Math.round((weight * (1 - bodyFat / 100) * 0.94 - 4.4) * 10) / 10 : null,
    vo2max: Math.round((50.5 + load.ctl * 0.035 + Math.sin(i / 50) * 0.4) * 10) / 10,
  };
}

export function rangeSummaries(endIso, days) {
  return dateRange(endIso, days).map(daySummary);
}

// --- Detalle de un día ---------------------------------------------------------------------

function sleepStages(summary, rng) {
  // Ciclos de ~90 min: el profundo se concentra al principio y el REM al final
  const wake = Math.round(410 + rng.noise() * 25);
  const start = wake - summary.sleep.minutes - summary.sleep.awake;
  const stages = [];
  let t = start;
  const push = (stage, minutes) => {
    if (minutes <= 0) return;
    stages.push({ stage, start: Math.round(t), end: Math.round(t + minutes) });
    t += minutes;
  };
  const cycles = Math.max(4, Math.round(summary.sleep.minutes / 92));
  const deepW = Array.from({ length: cycles }, (_, k) => cycles - k);
  const remW = Array.from({ length: cycles }, (_, k) => k + 1);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  push('awake', rng.int(6, 14));
  for (let k = 0; k < cycles; k++) {
    const deep = (summary.sleep.deep * deepW[k]) / sum(deepW);
    const rem = (summary.sleep.rem * remW[k]) / sum(remW);
    const light = summary.sleep.light / cycles;
    push('light', light * 0.55);
    push('deep', deep);
    push('light', light * 0.45);
    push('rem', rem);
    if (k < cycles - 1 && rng.chance(0.55)) push('awake', rng.int(2, 6));
  }
  stages.at(-1).end = wake;
  return { start, end: wake, stages };
}

function heartRateStream(summary, sleep, workout, until, rng) {
  const points = [];
  for (let t = 0; t <= Math.min(until, 1435); t += 5) {
    let bpm;
    const stage = sleep.stages.find((s) => t >= s.start && t < s.end)?.stage;
    if (t < sleep.end && stage) {
      bpm = summary.rhr + { deep: -2, light: 1, rem: 5, awake: 10 }[stage] + rng.noise();
    } else if (workout && t >= workout.start && t <= workout.end) {
      const p = (t - workout.start) / workout.minutes;
      const warm = Math.min(1, p * 6) * Math.min(1, (1 - p) * 8);
      const interval = workout.title.includes('Intervalos')
        ? Math.sin(p * Math.PI * 9) * 14
        : workout.sport === 'strength'
          ? Math.sin(p * Math.PI * 24) * 12
          : 0;
      bpm = 95 + (workout.avgHr - 95) * warm + interval * warm + rng.noise() * 3;
    } else if (t >= 1380) {
      bpm = summary.rhr + 12 + rng.noise() * 2;
    } else {
      const meal = [480, 840, 1275].some((m) => t > m && t < m + 60) ? 6 : 0;
      bpm = 70 + Math.sin(t / 47) * 4 + meal + rng.noise() * 4 + (rng.chance(0.04) ? 18 : 0);
    }
    points.push({ t, bpm: Math.round(bpm) });
  }
  return points;
}

function stepsByHour(summary, sleep, workout, rng) {
  const profile = Array.from({ length: 24 }, (_, h) => {
    if (h * 60 < sleep.end - 30 || h === 0) return 0;
    if (h >= 23) return 0.15;
    return [0.6, 1, 0.8, 0.9, 1.3, 1.6, 1, 0.8, 0.9, 1, 1.2, 1.5, 1.7, 1.2, 0.8, 0.4][h - 7] ?? 0.5;
  });
  if (workout?.sport === 'run') {
    for (let h = Math.floor(workout.start / 60); h * 60 < workout.end; h++) profile[h] += 7;
  }
  const weights = profile.map((p) => p * rng.between(0.6, 1.4));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map((w) => Math.round((w / total) * summary.steps));
}

const ext = (source, iso, kind, n = 0) =>
  `${source.slice(0, 2)}_${iso.replaceAll('-', '')}_${kind}${n ? `_${n}` : ''}`;
const at = (iso, minutes) => {
  const d = parseISODate(iso);
  d.setMinutes(minutes);
  return d.toISOString();
};

function buildEvents(iso, summary, sleep, workout, rng) {
  const events = [];
  const s = summary.sleep;

  events.push({
    id: `sleep-${iso}`,
    category: 'sleep',
    icon: 'Moon',
    title: 'Sueño',
    subtitle: `${Math.floor(s.minutes / 60)}h ${s.minutes % 60}m dormido · eficiencia ${s.efficiency}%`,
    start: sleep.start,
    end: sleep.end,
    metrics: [
      { label: 'Puntuación', value: s.score },
      { label: 'Profundo', value: s.deep, unit: 'min' },
      { label: 'REM', value: s.rem, unit: 'min' },
      { label: 'Despierto', value: s.awake, unit: 'min' },
    ],
    sleep: { ...sleep, totals: s },
    sources: [
      {
        source: 'google-health',
        primary: true,
        externalId: ext('google-health', iso, 'sleep'),
        recordedAt: at(iso, sleep.end + 3),
        values: {
          durationMin: s.minutes,
          deepMin: s.deep,
          remMin: s.rem,
          efficiency: s.efficiency,
        },
      },
    ],
  });

  if (summary.weight) {
    const t = sleep.end + rng.int(8, 20);
    const values = {
      weightKg: summary.weight,
      bodyFatPct: summary.bodyFat,
      muscleKg: summary.muscle,
    };
    events.push({
      id: `weight-${iso}`,
      category: 'body',
      icon: 'Scale',
      title: 'Pesaje',
      subtitle: `${String(summary.weight).replace('.', ',')} kg · grasa ${String(summary.bodyFat).replace('.', ',')}%`,
      start: t,
      metrics: [
        { label: 'Peso', value: summary.weight, unit: 'kg', digits: 1 },
        { label: 'Grasa', value: summary.bodyFat, unit: '%', digits: 1 },
        { label: 'Músculo', value: summary.muscle, unit: 'kg', digits: 1 },
        {
          label: 'Agua',
          value: Math.round((60.8 + rng.noise() * 0.4) * 10) / 10,
          unit: '%',
          digits: 1,
        },
      ],
      sources: [
        {
          source: 'xiaomi',
          primary: true,
          externalId: ext('xiaomi', iso, 'weight'),
          recordedAt: at(iso, t),
          values: { ...values, impedance: rng.int(480, 520), visceralFat: 6 },
        },
        {
          source: 'google-health',
          primary: false,
          externalId: ext('google-health', iso, 'weight'),
          recordedAt: at(iso, t + 2),
          values: { weightKg: summary.weight, bodyFatPct: summary.bodyFat },
          note: 'Copia sincronizada desde Zepp Life: mismo pesaje',
        },
      ],
    });
  }

  const coffee = sleep.end + rng.int(20, 40);
  events.push({
    id: `coffee-${iso}`,
    category: 'hydration',
    icon: 'Coffee',
    title: 'Café',
    subtitle: 'Doble espresso · 130 mg de cafeína',
    start: coffee,
    metrics: [
      { label: 'Cafeína', value: 130, unit: 'mg' },
      { label: 'Volumen', value: 60, unit: 'ml' },
    ],
    sources: [
      {
        source: 'telegram',
        primary: true,
        externalId: ext('telegram', iso, 'coffee'),
        recordedAt: at(iso, coffee),
        values: { text: 'café doble' },
      },
    ],
  });

  const n = summary.nutrition;
  const meals = [
    {
      key: 'breakfast',
      title: 'Desayuno',
      at: sleep.end + rng.int(35, 60),
      share: 0.24,
      text: 'Tostadas con aguacate y huevos revueltos',
    },
    {
      key: 'lunch',
      title: 'Comida',
      at: 840 + rng.int(-15, 30),
      share: 0.36,
      text: 'Arroz con pollo, ensalada y yogur',
    },
    {
      key: 'snack',
      title: 'Merienda',
      at: 1050 + rng.int(-20, 30),
      share: 0.1,
      text: 'Plátano y un puñado de nueces',
    },
    {
      key: 'dinner',
      title: 'Cena',
      at: 1275 + rng.int(-20, 25),
      share: 0.3,
      text: 'Salmón al horno con patata y verduras',
    },
  ];
  for (const meal of meals) {
    const kcal = Math.round(n.kcal * meal.share);
    const macros = {
      protein: Math.round(n.protein * meal.share),
      carbs: Math.round(n.carbs * meal.share),
      fat: Math.round(n.fat * meal.share),
    };
    const viaBot = meal.key !== 'snack';
    events.push({
      id: `${meal.key}-${iso}`,
      category: 'nutrition',
      icon: 'Utensils',
      title: meal.title,
      subtitle: `${meal.text} · ${kcal} kcal`,
      start: meal.at,
      metrics: [
        { label: 'Calorías', value: kcal, unit: 'kcal' },
        { label: 'Proteína', value: macros.protein, unit: 'g' },
        { label: 'Hidratos', value: macros.carbs, unit: 'g' },
        { label: 'Grasa', value: macros.fat, unit: 'g' },
      ],
      macros: { kcal, ...macros },
      sources: [
        {
          source: viaBot ? 'telegram' : 'fatsecret',
          primary: true,
          externalId: ext(viaBot ? 'telegram' : 'fatsecret', iso, meal.key),
          recordedAt: at(iso, meal.at + 4),
          values: viaBot
            ? { text: meal.text.toLowerCase(), estimatedBy: 'LLM', kcal, ...macros }
            : { kcal, ...macros },
        },
      ],
    });
  }

  if (workout) {
    const sport = SPORTS[workout.sport];
    const parts = [
      `${Math.floor(workout.minutes / 60) ? `${Math.floor(workout.minutes / 60)}h ` : ''}${workout.minutes % 60}m`,
    ];
    if (workout.distanceKm) parts.push(`${String(workout.distanceKm).replace('.', ',')} km`);
    parts.push(`${workout.avgHr} ppm`, `TSS ${workout.tss}`);
    const metrics = [
      { label: 'Duración', value: workout.minutes, unit: 'min' },
      { label: 'TSS', value: workout.tss },
      { label: 'FC media', value: workout.avgHr, unit: 'ppm' },
      { label: 'Calorías', value: workout.kcal, unit: 'kcal' },
    ];
    if (workout.distanceKm)
      metrics.splice(1, 0, {
        label: 'Distancia',
        value: workout.distanceKm,
        unit: 'km',
        digits: 1,
      });
    if (workout.avgPower)
      metrics.push({ label: 'Potencia media', value: workout.avgPower, unit: 'W' });
    if (workout.normalizedPower)
      metrics.push({ label: 'Potencia normalizada', value: workout.normalizedPower, unit: 'W' });
    const sources =
      workout.sport === 'strength'
        ? [
            {
              source: 'google-health',
              primary: true,
              externalId: ext('google-health', iso, 'exercise'),
              recordedAt: at(iso, workout.end + 2),
              values: {
                type: 'STRENGTH_TRAINING',
                durationMin: workout.minutes,
                avgHr: workout.avgHr,
                kcal: workout.kcal,
              },
            },
            {
              source: 'telegram',
              primary: false,
              externalId: ext('telegram', iso, 'sets'),
              recordedAt: at(iso, workout.end + 10),
              values: { exercises: workout.exercises.length },
              note: 'Series y repeticiones (Google no las guarda)',
            },
          ]
        : [
            {
              source: 'strava',
              primary: true,
              externalId: ext('strava', iso, 'activity'),
              recordedAt: at(iso, workout.end + 3),
              values: {
                distanceKm: workout.distanceKm,
                movingMin: workout.minutes,
                avgHr: workout.avgHr,
                elevationM: workout.elevation,
              },
            },
            {
              source: 'intervals-icu',
              primary: false,
              externalId: ext('intervals-icu', iso, 'activity'),
              recordedAt: at(iso, workout.end + 6),
              values: {
                tss: workout.tss,
                intensityFactor:
                  Math.round((workout.tss / workout.minutes) * 60 ** 0.5 * 0.13 * 100) / 100,
              },
              note: 'Misma actividad importada de Strava: aporta la carga',
            },
            {
              source: 'google-health',
              primary: false,
              externalId: ext('google-health', iso, 'exercise'),
              recordedAt: at(iso, workout.end + 2),
              values: {
                durationMin: workout.minutes + 1,
                avgHr: workout.avgHr + 1,
                kcal: workout.kcal,
              },
            },
          ];
    events.push({
      id: `workout-${iso}`,
      category: 'activity',
      icon: sport.icon,
      title: workout.title,
      subtitle: `${sport.label} · ${parts.join(' · ')}`,
      start: workout.start,
      end: workout.end,
      metrics,
      workout,
      sources,
    });
  }

  return events.sort((a, b) => a.start - b.start);
}

/** Detalle completo de un día. Si es hoy, solo hasta la hora actual. */
export function dayDetail(iso, now = new Date()) {
  const summary = daySummary(iso);
  const rng = seeded(`detail:${iso}`);
  const isToday = iso === todayISO();
  const until = isToday ? minutesOfDay(now) : 1440;
  const sleep = sleepStages(summary, rng);
  const workout = summary.workout;
  const hr = heartRateStream(summary, sleep, workout, until, rng);
  const steps = stepsByHour(summary, sleep, workout, rng).map((v, h) =>
    h * 60 > until ? null : v,
  );
  const events = buildEvents(iso, summary, sleep, workout, rng).filter(
    (e) => (e.end ?? e.start) <= until || e.start <= until,
  );

  // Hoy: los totales van por lo que llevamos de día
  const dayFraction = isToday ? Math.max(0.05, (until - sleep.end) / (1440 - sleep.end)) : 1;
  const done = events.filter((e) => e.category === 'nutrition');
  const eaten = done.reduce((acc, e) => acc + e.macros.kcal, 0);
  return {
    ...summary,
    isToday,
    until,
    hr,
    stepsByHour: steps,
    sleepDetail: sleep,
    steps: isToday ? steps.reduce((a, b) => a + (b ?? 0), 0) : summary.steps,
    distanceKm: isToday
      ? Math.round(steps.reduce((a, b) => a + (b ?? 0), 0) * 0.00076 * 10) / 10
      : summary.distanceKm,
    activeKcal: Math.round(summary.activeKcal * dayFraction),
    nutrition: {
      ...summary.nutrition,
      kcal: eaten,
      protein: done.reduce((acc, e) => acc + e.macros.protein, 0),
      carbs: done.reduce((acc, e) => acc + e.macros.carbs, 0),
      fat: done.reduce((acc, e) => acc + e.macros.fat, 0),
      waterMl: Math.round((summary.nutrition.waterMl * dayFraction) / 50) * 50,
    },
    events,
  };
}
