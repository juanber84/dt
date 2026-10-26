import { MEAL_TYPE_LABELS } from '@digitaltwin/nutrition';
import { DAY_MS, localMidnight } from '@digitaltwin/timeline';
import {
  PERIOD_NAMES,
  creatinePhrase,
  currentPeriod,
  fluidTargetMl,
  periodPhrase,
} from '@digitaltwin/engine';

const DAY_METRICS = [
  'intake.energy',
  'intake.protein',
  'intake.carbs',
  'intake.fat',
  'intake.water',
  'intake.beverages',
  'activity.steps',
];

const localDate = (date, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
const localTime = (date, timeZone) =>
  new Intl.DateTimeFormat('es-ES', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(date));

export const addDays = (date, n) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** El día anterior a `now` en la zona del usuario (el del informe de la mañana). */
export const yesterday = (now, timeZone) => addDays(localDate(now, timeZone), -1);

/**
 * Lo que pasó un día, ya sumado: solo datos de la BD y del motor, nada estimado aquí. Lo que no
 * hay queda en null (el informe dice "sin datos").
 * @param {object} deps
 * @param {string} deps.userId
 * @param {string} deps.date  YYYY-MM-DD, en la zona del usuario
 * @param {Date} deps.now  Hasta cuándo buscar el sueño de la noche siguiente
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createTimelineQueries>} deps.queries
 * @param {{ state: (userId: string) => Promise<object> }} deps.engine
 * @param {string} deps.timeZone
 */
export async function gatherDay({ userId, date, now, queries, engine, timeZone }) {
  const from = localMidnight(date, timeZone);
  const to = new Date(from.getTime() + DAY_MS);
  const weekFrom = localMidnight(addDays(date, -6), timeZone);
  const [episodes, sleeps, series, week, state, periods] = await Promise.all([
    queries.episodes({
      userId,
      from,
      to,
      kinds: ['meal', 'workout', 'symptom', 'medication', 'supplement'],
      timeZone,
    }),
    // La noche de después (la que acaba esta mañana): empieza a partir del mediodía del día
    queries.episodes({
      userId,
      from: new Date(from.getTime() + DAY_MS / 2),
      to: now,
      kinds: ['sleep'],
      timeZone,
    }),
    queries.series({ userId, from, to, bucket: 'day', metrics: DAY_METRICS, timeZone }),
    queries.series({
      userId,
      from: weekFrom,
      to,
      bucket: 'day',
      metrics: ['intake.energy'],
      timeZone,
    }),
    engine.state(userId),
    // Periodos que tocan el día o acabaron hace poco (pueden haber empezado mucho antes)
    queries.episodes({
      userId,
      from: new Date(from.getTime() - 90 * DAY_MS),
      to,
      kinds: ['period'],
      timeZone,
    }),
  ]);

  const dayValue = (code) => {
    const point = series[code]?.points.find((p) => localDate(new Date(p.t), timeZone) === date);
    return point ? point.value : null;
  };
  const of = (kind) => episodes.filter((e) => e.kind === kind);
  const workouts = of('workout');
  const trainingMinutes = workouts.reduce((sum, w) => sum + minutesOf(w), 0);
  const water = dayValue('intake.water');
  const beverages = dayValue('intake.beverages');
  const sleep = sleeps
    .filter((s) => s.summary?.asleepMinutes)
    .sort((a, b) => b.summary.asleepMinutes - a.summary.asleepMinutes)[0];
  const ready = state?.ready === true;
  const period = currentPeriod(
    periods.filter((p) => p.summary?.from && p.summary?.to).map((p) => p.summary),
    date,
  );

  return {
    date,
    period,
    // Creatina empezada o dejada hace poco: el peso mueve agua (aviso del motor)
    creatine: ready ? (state.creatine ?? null) : null,
    weight: ready
      ? {
          last: state.weight.last,
          trend: state.weight.trend,
          bodyFat: state.weight.bodyFat,
          kgPerWeek: state.expenditure?.trendKgPerWeek ?? null,
        }
      : null,
    targets: ready ? state.targets : null,
    intake: {
      kcal: dayValue('intake.energy'),
      proteinG: dayValue('intake.protein'),
      carbsG: dayValue('intake.carbs'),
      fatG: dayValue('intake.fat'),
    },
    fluids: {
      waterMl: water,
      beveragesMl: beverages,
      totalMl: water == null && beverages == null ? null : (water ?? 0) + (beverages ?? 0),
      targetMl: fluidTargetMl(trainingMinutes),
    },
    meals: of('meal').map((m) => ({
      time: localTime(m.start, timeZone),
      type: m.summary?.mealType ?? null,
      name: m.title,
      kcal: m.summary?.kcal ?? null,
      proteinG: m.summary?.proteinG ?? null,
    })),
    workouts: workouts.map((w) => ({
      time: localTime(w.start, timeZone),
      title: w.title,
      minutes: Math.round(minutesOf(w)),
      km: w.summary?.distanceM ? Math.round(w.summary.distanceM / 100) / 10 : null,
      kcal: w.summary?.kcal ?? null,
    })),
    sleep: sleep
      ? {
          asleepMinutes: sleep.summary.asleepMinutes,
          from: localTime(sleep.start, timeZone),
          to: sleep.end ? localTime(sleep.end, timeZone) : null,
        }
      : null,
    steps: dayValue('activity.steps'),
    symptoms: of('symptom').map((s) => ({
      time: localTime(s.start, timeZone),
      text: s.title,
      intensity: s.summary?.intensity ?? null,
    })),
    medications: of('medication').map((m) => ({
      time: localTime(m.start, timeZone),
      name: m.title,
      dose: m.summary?.dose ?? null,
    })),
    supplements: of('supplement').map((m) => ({
      time: localTime(m.start, timeZone),
      name: m.title,
      dose: m.summary?.dose ?? null,
    })),
    weightHistory: ready ? state.trend : [],
    kcalWeek: Array.from({ length: 7 }, (_, i) => {
      const day = addDays(date, i - 6);
      const point = week['intake.energy']?.points.find(
        (p) => localDate(new Date(p.t), timeZone) === day,
      );
      return { date: day, kcal: point ? point.value : null };
    }),
  };
}

function minutesOf(w) {
  const seconds =
    w.summary?.durationS ?? (w.end ? (Date.parse(w.end) - Date.parse(w.start)) / 1000 : 0);
  return Math.max(0, seconds) / 60;
}

const hm = (minutes) =>
  `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;

/** "martes 22 de octubre" */
export function longDate(date) {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
    .format(new Date(`${date}T12:00:00Z`))
    .replace(',', '');
}

/**
 * El informe de la mañana con los datos de `gatherDay` y el comentario del coach (o sin él, si
 * el LLM no está o falla: las cifras van igual).
 * @param {ReturnType<typeof gatherDay> extends Promise<infer T> ? T : never} day
 * @param {{ comment?: string | null }} [options]
 */
export function composeDaily(day, { comment = null } = {}) {
  const t = day.targets;
  const blocks = [];
  if (comment) blocks.push({ type: 'text', text: comment });
  const p = day.period;
  if (p?.phase === 'during') {
    blocks.push({
      type: 'callout',
      tone: 'info',
      text: `${PERIOD_NAMES[p.type] ?? PERIOD_NAMES.other} (${periodPhrase(p)}): el motor no aprende de estos días y el objetivo está en mantenimiento.`,
    });
  } else if (p?.phase === 'settling') {
    blocks.push({
      type: 'callout',
      tone: 'info',
      text: `Volviste ${periodPhrase({ from: p.to, to: p.to })}: estos días el peso suele venir con agua y sal, así que cuenta menos en la tendencia.`,
    });
  }

  blocks.push({
    type: 'stats',
    title: 'Comida',
    items: [
      { label: 'Calorías', value: day.intake.kcal, unit: 'kcal', target: t?.kcal ?? null },
      { label: 'Proteína', value: day.intake.proteinG, unit: 'g', target: t?.proteinG ?? null },
      { label: 'Hidratos', value: day.intake.carbsG, unit: 'g', target: t?.carbsG ?? null },
      { label: 'Grasa', value: day.intake.fatG, unit: 'g', target: t?.fatG ?? null },
      {
        label: 'Líquidos',
        value: day.fluids.totalMl == null ? null : day.fluids.totalMl / 1000,
        unit: 'L',
        digits: 1,
        target: day.fluids.targetMl / 1000,
      },
    ],
  });
  if (day.meals.length) {
    blocks.push({
      type: 'table',
      title: 'Lo que comiste',
      columns: ['Hora', 'Comida', 'Plato', 'kcal', 'Proteína'],
      rows: day.meals.map((m) => [
        m.time,
        MEAL_TYPE_LABELS[m.type] ?? '',
        m.name,
        m.kcal == null ? null : Math.round(m.kcal),
        m.proteinG == null ? null : `${Math.round(m.proteinG)} g`,
      ]),
    });
  } else if (p?.phase !== 'during') {
    blocks.push({ type: 'callout', tone: 'info', text: 'No apuntaste ninguna comida.' });
  }
  if (day.kcalWeek.some((d) => d.kcal != null)) {
    blocks.push({
      type: 'chart',
      title: 'Calorías, últimos 7 días',
      bucket: 'day',
      kind: 'bar',
      average: false,
      labels: day.kcalWeek.map((d) => d.date),
      series: [
        {
          code: 'intake.energy',
          label: 'Calorías',
          unit: 'kcal',
          aggregation: 'sum',
          values: day.kcalWeek.map((d) => d.kcal),
        },
      ],
      ...(t?.kcal && { target: { value: t.kcal, label: 'Objetivo' } }),
    });
  }

  blocks.push({
    type: 'stats',
    title: 'Cuerpo y actividad',
    items: [
      { label: 'Peso', value: day.weight?.last ?? null, unit: 'kg', digits: 1 },
      {
        label: 'Tendencia',
        value: day.weight?.trend ?? null,
        unit: 'kg',
        digits: 1,
        ...(day.weight?.kgPerWeek != null && {
          note: `${day.weight.kgPerWeek > 0 ? '+' : ''}${String(day.weight.kgPerWeek).replace('.', ',')} kg/semana`,
        }),
      },
      {
        label: 'Sueño de anoche',
        value: day.sleep ? Math.round((day.sleep.asleepMinutes / 60) * 10) / 10 : null,
        unit: 'h',
        digits: 1,
        ...(day.sleep && {
          note: `${hm(day.sleep.asleepMinutes)}${day.sleep.to ? `, de ${day.sleep.from} a ${day.sleep.to}` : ''}`,
        }),
      },
      { label: 'Pasos', value: day.steps },
    ],
  });
  if (day.workouts.length) {
    blocks.push({
      type: 'table',
      title: 'Entrenos',
      columns: ['Hora', 'Entreno', 'Duración', 'Distancia', 'kcal'],
      rows: day.workouts.map((w) => [
        w.time,
        w.title,
        `${w.minutes} min`,
        w.km == null ? null : `${String(w.km).replace('.', ',')} km`,
        w.kcal == null ? null : Math.round(w.kcal),
      ]),
    });
  }
  if (day.creatine) {
    blocks.push({ type: 'callout', tone: 'info', text: creatinePhrase(day.creatine) });
  }
  const weights = day.weightHistory.filter((d) => d.weight != null || d.trend != null);
  if (weights.length >= 2) {
    blocks.push({
      type: 'chart',
      title: 'Peso, últimas semanas',
      bucket: 'day',
      kind: 'line',
      average: false,
      labels: weights.map((d) => d.date),
      series: [
        {
          code: 'body.weight',
          label: 'Peso',
          unit: 'kg',
          aggregation: 'last',
          style: 'points',
          values: weights.map((d) => d.weight ?? null),
        },
        {
          code: 'engine.trend',
          label: 'Tendencia',
          unit: 'kg',
          aggregation: 'last',
          values: weights.map((d) => d.trend ?? null),
        },
      ],
    });
  }

  const health = [
    ...day.symptoms.map(
      (s) => `${s.time} · ${s.text}${s.intensity != null ? ` (intensidad ${s.intensity}/5)` : ''}`,
    ),
    ...day.medications.map((m) => `${m.time} · ${m.name}${m.dose ? `, ${m.dose}` : ''}`),
  ];
  if (health.length) {
    blocks.push({ type: 'callout', tone: 'warning', text: `Salud\n${health.join('\n')}` });
  }

  return {
    kind: 'daily',
    title: `Tu día: ${longDate(day.date)}`,
    periodFrom: day.date,
    periodTo: day.date,
    blocks,
  };
}

const n = (value, digits = 0) =>
  value == null
    ? null
    : new Intl.NumberFormat('es-ES', { maximumFractionDigits: digits }).format(value);
const ofTarget = (value, target, unit) =>
  `${n(value)}${target != null ? ` de ${n(target)}` : ''} ${unit}`;
const dm = (date) => `${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`;

/**
 * Los datos del día redactados para el coach, sin nada que interpretar: lo que falta dice "sin
 * apuntar" (no 0) y la tendencia del peso dice si sube o baja frente al objetivo. Con JSON y
 * signos, el modelo llegó a leer "+0,28 kg/semana" como que bajaba.
 */
export function commentFacts(day) {
  const lines = [];
  const p = day.period;
  if (p?.phase === 'during') {
    lines.push(
      `Periodo: ese día estaba ${p.type === 'away' ? 'fuera de casa' : p.type === 'sick' ? 'enfermo' : 'en un periodo especial'} (${periodPhrase(p)}). No le reproches no apuntar ni no pesarse; el objetivo está en mantenimiento.`,
    );
  } else if (p?.phase === 'settling') {
    lines.push(
      `Periodo: volvió ${periodPhrase({ from: p.to, to: p.to })} (${p.type === 'away' ? 'de fuera de casa' : p.type === 'sick' ? 'de estar enfermo' : 'de un periodo'}). Si el peso ha subido, es sobre todo agua y sal: dilo para que no se agobie.`,
    );
  }
  const i = day.intake;
  const t = day.targets;
  if (i.kcal == null && !day.meals.length) {
    lines.push('Comida: no apuntó nada (no es que no comiera: falta apuntarlo).');
  } else {
    lines.push(
      `Comida: ${ofTarget(i.kcal, t?.kcal, 'kcal')}; proteína ${ofTarget(i.proteinG, t?.proteinG, 'g')}; hidratos ${ofTarget(i.carbsG, t?.carbsG, 'g')}; grasa ${ofTarget(i.fatG, t?.fatG, 'g')}.`,
    );
    for (const m of day.meals) {
      lines.push(
        `  - ${m.time}${m.type ? ` ${MEAL_TYPE_LABELS[m.type]}` : ''}: ${m.name} (${n(m.kcal) ?? '?'} kcal, ${n(m.proteinG) ?? '?'} g proteína)`,
      );
    }
  }
  const f = day.fluids;
  lines.push(
    f.totalMl == null
      ? `Líquidos: sin apuntar (objetivo ${n(f.targetMl / 1000, 1)} L).`
      : `Líquidos: ${n(f.totalMl / 1000, 1)} L de ${n(f.targetMl / 1000, 1)} L (agua ${n((f.waterMl ?? 0) / 1000, 1)} L, otras bebidas ${n((f.beveragesMl ?? 0) / 1000, 1)} L).`,
  );
  lines.push(
    day.workouts.length
      ? `Entrenos: ${day.workouts.map((w) => `${w.time} ${w.title}, ${w.minutes} min${w.km != null ? `, ${n(w.km, 1)} km` : ''}`).join('; ')}.`
      : 'Entrenos: ninguno registrado.',
  );
  lines.push(
    day.sleep
      ? `Sueño de anoche: ${Math.floor(day.sleep.asleepMinutes / 60)} h ${day.sleep.asleepMinutes % 60} min dormido${day.sleep.to ? ` (de ${day.sleep.from} a ${day.sleep.to})` : ''}.`
      : 'Sueño de anoche: aún sin datos (puede que no se haya sincronizado todavía; no supongas que no durmió).',
  );
  lines.push(day.steps == null ? 'Pasos: sin datos.' : `Pasos: ${n(day.steps)}.`);
  const w = day.weight;
  if (w) {
    const pace = w.kgPerWeek;
    const goal = t?.kgPerWeek;
    const direction =
      pace == null
        ? 'sin tendencia todavía'
        : pace > 0.05
          ? `SUBE ${n(pace, 2)} kg/semana`
          : pace < -0.05
            ? `BAJA ${n(-pace, 2)} kg/semana`
            : 'estable';
    const target =
      goal == null
        ? ''
        : goal < 0
          ? `; su objetivo es BAJAR ${n(-goal, 2)} kg/semana`
          : goal > 0
            ? `; su objetivo es SUBIR ${n(goal, 2)} kg/semana`
            : '; su objetivo es mantenerse';
    lines.push(
      `Peso: último ${n(w.last, 1) ?? 'sin datos'} kg${w.bodyFat != null ? ` (${n(w.bodyFat, 1)} % grasa)` : ''}; tendencia ${n(w.trend, 1)} kg, ${direction}${target}.`,
    );
  } else {
    lines.push('Peso: sin datos suficientes para la tendencia.');
  }
  const c = day.creatine;
  if (c) {
    lines.push(
      c.phase === 'starting'
        ? `Creatina: empezó el ${dm(c.since)}; si el peso sube, es agua en el músculo (1-2 kg las primeras 3-4 semanas), no grasa. Dilo si comentas el peso; que no recorte comida.`
        : `Creatina: la dejó el ${dm(c.since)}; si el peso baja, es agua (1-2 kg en unas semanas), no grasa perdida. No lo celebres como progreso.`,
    );
  }
  if (day.supplements?.length) {
    lines.push(
      `Suplementos tomados: ${day.supplements.map((m) => `${m.time} ${m.name}${m.dose ? ` ${m.dose}` : ''}`).join('; ')}.`,
    );
  }
  lines.push(
    `Calorías de los últimos 7 días: ${day.kcalWeek.map((d) => `${dm(d.date)} ${d.kcal == null ? 'sin apuntar' : `${n(d.kcal)} kcal`}`).join(', ')}.`,
  );
  const health = [
    ...day.symptoms.map(
      (s) => `${s.time} síntoma: ${s.text}${s.intensity != null ? ` (${s.intensity}/5)` : ''}`,
    ),
    ...day.medications.map((m) => `${m.time} medicación: ${m.name}${m.dose ? `, ${m.dose}` : ''}`),
  ];
  if (health.length) lines.push(`Salud: ${health.join('; ')}.`);
  return lines.join('\n');
}
