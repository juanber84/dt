import { z } from 'zod';
import { localMidnight } from '@digitaltwin/timeline';

const DAY_MS = 24 * 3600 * 1000;
// Lo que guarda el timeline (weigh-in = pesaje; los clínicos, de los informes confirmados)
const EPISODE_KINDS = [
  'meal',
  'workout',
  'sleep',
  'weigh-in',
  'drink',
  'symptom',
  'note',
  'medication',
  'supplement',
  'period',
  'lab',
  'holter',
  'stress-test',
  'ecg',
  'imaging',
  'medical-test',
  'medical-report',
];

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha YYYY-MM-DD')
  .describe('Fecha local YYYY-MM-DD (zona horaria del usuario)');
const range = {
  from: date.describe('Primer día incluido, YYYY-MM-DD'),
  to: date.describe('Último día incluido, YYYY-MM-DD'),
};

/**
 * Herramientas de lectura sobre el timeline de UN usuario. El usuario viene de quien llama (el
 * token), nunca de los argumentos: una IA no puede pedir datos de otro.
 *
 * Cada herramienta es { name, title, description, inputSchema (shape de zod), handler }. Las
 * registra el servidor MCP y las podrá usar igual la IA de la app sin pasar por la red.
 *
 * Las salidas son pequeñas a propósito (agregados, límites duros): cada fila le cuesta tokens al
 * modelo y con miles se pierde.
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createTimelineQueries>} deps.queries
 * @param {string} deps.userId
 * @param {string} deps.timeZone  zona de los días (Europe/Madrid)
 * @param {() => Date} [deps.now]
 * @param {() => Promise<object>} [deps.getProfile]  Edad, sexo, altura... (sin ella no hay get_profile)
 * @param {() => Promise<object>} [deps.getEngine]  Estado del motor (sin él no hay get_engine)
 */
export function createTools({
  queries,
  userId,
  timeZone,
  now = () => new Date(),
  getProfile,
  getEngine,
}) {
  const today = () => localDate(now(), timeZone);
  /** [from 00:00, día siguiente a `to` 00:00) en la zona del usuario */
  const window = (from, to) => ({
    from: localMidnight(from, timeZone),
    to: localMidnight(addDays(to, 1), timeZone),
  });
  const days = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;

  const profileTool = getProfile && {
    name: 'get_profile',
    title: 'Perfil',
    description: 'Edad, sexo, altura y peso objetivo del usuario.',
    inputSchema: {},
    handler: async () => {
      const { age, sex, heightCm, weightGoalKg } = await getProfile();
      return { age, sex, heightCm, weightGoalKg };
    },
  };

  const engineTool = getEngine && {
    name: 'get_engine',
    title: 'Motor: peso real, gasto real y objetivos',
    description:
      'Lo que calcula el motor de TwinMe con la comida apuntada y la báscula (no con el ' +
      'reloj): peso tendencia, gasto real estimado (con su confianza y días apuntados), objetivos ' +
      'de kcal y macros para el ritmo elegido, aviso si lo apuntado no cuadra con el peso, aviso ' +
      'si empezó o dejó la creatina hace menos de 4 semanas (creatine: el peso mueve 1-2 kg de ' +
      'agua, no grasa), y el ' +
      'historial de las últimas semanas (tendencia del peso y gasto estimado día a día). Son las ' +
      'cifras buenas: úsalas en vez de las kcal activas de los relojes.',
    inputSchema: {},
    handler: async () => {
      const state = await getEngine();
      if (!state?.ready) return { ready: false, missing: state?.missing ?? [] };
      const { history, ...expenditure } = state.expenditure;
      return {
        ...state,
        expenditure,
        // Una fila por día: menos tokens que dos listas por separado
        history: state.trend.map((d) => ({
          date: d.date,
          weight: d.weight,
          trend: d.trend,
          expenditure: history.find((h) => h.date === d.date)?.kcal ?? null,
        })),
        trend: undefined,
      };
    },
  };

  return [
    ...(profileTool ? [profileTool] : []),
    ...(engineTool ? [engineTool] : []),
    {
      name: 'list_metrics',
      title: 'Métricas disponibles',
      description:
        'Lista las métricas con datos del usuario (código, nombre, unidad, cómo se agregan y el ' +
        'rango de fechas con datos). Úsala primero para saber qué códigos pedir en get_series. ' +
        'aggregation: avg = se promedia (peso, FC), sum = se suma en el día (pasos, kcal), ' +
        'last = un valor por día (FC en reposo, VO2max).',
      inputSchema: {},
      handler: async () => {
        const items = await queries.availableMetrics(userId);
        return {
          timeZone,
          today: today(),
          metrics: items.map((m) => ({
            code: m.code,
            label: m.label,
            unit: m.unit,
            aggregation: m.aggregation,
            first: localDate(new Date(m.first), timeZone),
            last: localDate(new Date(m.last), timeZone),
          })),
        };
      },
    },

    {
      name: 'get_series',
      title: 'Series diarias u horarias',
      description:
        'Valores de una o varias métricas por día (hasta 400 días) o por hora (hasta 7 días). ' +
        'Es el valor canónico: si varias fuentes miden lo mismo, manda la de más prioridad, sin ' +
        'sumar dos veces. Para tendencias (peso, grasa) pide días y fíjate en la media de varios ' +
        'días, no en un valor suelto: la báscula oscila por el agua.',
      inputSchema: {
        metrics: z
          .array(z.string().min(1).max(80))
          .min(1)
          .max(10)
          .describe('Códigos de métrica de list_metrics, p. ej. ["body.weight", "intake.protein"]'),
        ...range,
        bucket: z.enum(['day', 'hour']).default('day'),
      },
      handler: async ({ metrics, from, to, bucket = 'day' }) => {
        const span = days(from, to);
        const max = bucket === 'hour' ? 7 : 400;
        if (span < 1) throw new ToolError('`to` no puede ser anterior a `from`');
        if (span > max) throw new ToolError(`Por ${bucket} como mucho ${max} días`);

        const series = await queries.series({
          userId,
          ...window(from, to),
          bucket,
          metrics,
          timeZone,
        });
        const out = {};
        for (const [code, s] of Object.entries(series)) {
          out[code] = {
            label: s.label,
            unit: s.unit,
            aggregation: s.aggregation,
            points: s.points.map((p) => ({
              [bucket === 'day' ? 'date' : 't']:
                bucket === 'day' ? localDate(new Date(p.t), timeZone) : localTime(p.t, timeZone),
              value: p.value,
            })),
          };
        }
        const missing = metrics.filter((code) => !out[code]);
        return { timeZone, bucket, series: out, ...(missing.length && { noData: missing }) };
      },
    },

    {
      name: 'get_episodes',
      title: 'Comidas, entrenos, sueño, pesajes, síntomas, medicación, suplementos…',
      description:
        'Episodios del usuario entre dos días (hasta 31): comidas (meal; summary.mealType dice si ' +
        'fue desayuno, media mañana, comida, merienda, cena o picoteo, si lo tiene), entrenos (workout), ' +
        'noches de sueño (sleep), pesajes (weigh-in), agua y café (drink), síntomas (symptom, con ' +
        'intensidad 1-5), notas (note), tomas de medicación (medication), tomas de suplementos ' +
        '(supplement: creatina, magnesio...; summary.dose), periodos fuera de casa o ' +
        'enfermo (period: summary.type away/sick/other, from y to; el motor no aprende de esos ' +
        'días) y pruebas médicas ' +
        '(lab, holter, stress-test, ecg, imaging, medical-test, medical-report). Devuelve el resumen ' +
        'de cada uno; con details=true, también el detalle completo (platos y alimentos, ' +
        'vueltas...), que ocupa mucho: pídelo solo para rangos cortos.',
      inputSchema: {
        ...range,
        kinds: z.array(z.enum(EPISODE_KINDS)).optional().describe('Por defecto, todos'),
        details: z.boolean().default(false),
      },
      handler: async ({ from, to, kinds, details = false }) => {
        const span = days(from, to);
        if (span < 1) throw new ToolError('`to` no puede ser anterior a `from`');
        if (span > 31) throw new ToolError('Como mucho 31 días');
        if (details && span > 3) throw new ToolError('Con details=true, como mucho 3 días');

        const items = await queries.episodes({ userId, ...window(from, to), kinds, timeZone });
        return {
          timeZone,
          episodes: items.map((e) => compactEpisode(e, timeZone, details)),
        };
      },
    },

    {
      name: 'get_strength_sets',
      title: 'Entrenos de fuerza serie a serie',
      description:
        'Cada entreno de fuerza entre dos días (hasta 92) con todas sus series: ' +
        '"8x70" = 8 reps con 70 kg, "12" = 12 reps sin peso, "45s" = 45 segundos (plancha...). ' +
        'Para ver la progresión de un ejercicio (pesos, reps, volumen) o analizar entrenos. Los ' +
        'nombres de los ejercicios están en inglés (Barbell Bench Press, Back Squat...): con ' +
        '`exercise` se filtra por parte del nombre (p. ej. "squat", "bench").',
      inputSchema: {
        ...range,
        exercise: z
          .string()
          .trim()
          .min(2)
          .max(60)
          .optional()
          .describe('Solo los ejercicios cuyo nombre contenga esto (en inglés, sin mayúsculas)'),
      },
      handler: async ({ from, to, exercise }) => {
        const span = days(from, to);
        if (span < 1) throw new ToolError('`to` no puede ser anterior a `from`');
        if (span > 92) throw new ToolError('Como mucho 92 días');

        const needle = exercise?.toLowerCase();
        const items = await queries.episodes({
          userId,
          ...window(from, to),
          kinds: ['workout'],
          timeZone,
        });
        const workouts = items
          .filter((e) => e.schema === 'motra.workout@1')
          .map((e) => ({
            start: localTime(e.start, timeZone),
            title: e.title,
            exercises: (e.details?.exercises ?? [])
              .filter((x) => !needle || String(x.name).toLowerCase().includes(needle))
              .map(strengthLine),
          }))
          .filter((w) => w.exercises.length);
        return { timeZone, workouts };
      },
    },

    {
      name: 'get_observations',
      title: 'Datos crudos de una métrica',
      description:
        'Mediciones sueltas de una métrica, de todas las fuentes y sin resolver duplicados (hasta ' +
        '2 días, 500 puntos). Solo para hacer zoom (p. ej. la FC durante un entreno o cada ' +
        'pesaje del día); para lo demás usa get_series.',
      inputSchema: {
        metric: z.string().min(1).max(80).describe('Código de métrica, p. ej. "heart.rate"'),
        ...range,
      },
      handler: async ({ metric, from, to }) => {
        const span = days(from, to);
        if (span < 1) throw new ToolError('`to` no puede ser anterior a `from`');
        if (span > 2) throw new ToolError('Los datos crudos se piden como mucho de 2 en 2 días');

        const limit = 500;
        const items = await queries.observations({
          userId,
          metric,
          ...window(from, to),
          limit: limit + 1,
        });
        return {
          timeZone,
          metric,
          truncated: items.length > limit,
          points: items.slice(0, limit).map((o) => ({
            t: localTime(o.t, timeZone),
            ...(o.end && { end: localTime(o.end, timeZone) }),
            value: o.value,
            provider: o.provider,
          })),
        };
      },
    },

    {
      name: 'get_day_summary',
      title: 'Resumen de un día',
      description:
        'Todo lo de un día de un vistazo: el valor del día de cada métrica con datos (pasos, ' +
        'kcal y macros comidos, peso, FC en reposo, sueño...) y sus episodios (comidas, entrenos, ' +
        'sueño, pesajes) y `hydration`, los líquidos del día ya sumados (agua + otras bebidas, ' +
        'sin alcohol). Ojo: el día en curso puede estar incompleto (comidas sin apuntar, ' +
        'sincronizaciones pendientes).',
      inputSchema: {
        date: date.optional().describe('YYYY-MM-DD; por defecto, hoy'),
      },
      handler: async ({ date: day } = {}) => {
        day ??= today();
        const span = window(day, day);
        const [series, episodes] = await Promise.all([
          queries.series({ userId, ...span, bucket: 'day', timeZone }),
          queries.episodes({ userId, ...span, timeZone }),
        ]);
        const metrics = {};
        for (const [code, s] of Object.entries(series)) {
          const point = s.points[0];
          if (point) metrics[code] = { label: s.label, value: point.value, unit: s.unit };
        }
        // Líquidos del día ya sumados: agua + lo que hidratan las demás bebidas (sin alcohol)
        const waterMl = metrics['intake.water']?.value ?? null;
        const beveragesMl = metrics['intake.beverages']?.value ?? null;
        const hydration =
          waterMl != null || beveragesMl != null
            ? {
                fluidMl: Math.round((waterMl ?? 0) + (beveragesMl ?? 0)),
                waterMl: waterMl == null ? 0 : Math.round(waterMl),
                beveragesMl: beveragesMl == null ? 0 : Math.round(beveragesMl),
              }
            : null;
        return {
          date: day,
          timeZone,
          isToday: day === today(),
          metrics,
          ...(hydration && { hydration }),
          episodes: episodes.map((e) => compactEpisode(e, timeZone, false)),
        };
      },
    },
  ];
}

/** Error que se le cuenta a la IA (argumentos fuera de rango...), no un fallo del servidor. */
export class ToolError extends Error {
  name = 'ToolError';
}

/** Una serie en corto: "8x70" (reps x kg), "12" (sin peso), "45s" o "45s x10" (por tiempo). */
function setText({ reps, weightKg, timeS }) {
  const kg = weightKg > 0 ? `x${weightKg}` : '';
  if (reps != null) return `${reps}${kg}`;
  if (timeS != null) return `${Math.round(timeS)}s${kg && ` ${kg}`}`;
  return '?';
}

/** Un ejercicio de fuerza: sus series en corto y el descanso medio entre ellas. */
function strengthLine({ name, primaryMuscleGroups, sets = [] }) {
  const rests = sets.map((s) => s.restS).filter((r) => r > 0);
  return {
    name,
    ...(primaryMuscleGroups?.length && { muscles: primaryMuscleGroups }),
    sets: sets.map(setText),
    ...(rests.length && {
      restS: Math.round(rests.reduce((a, b) => a + b, 0) / rests.length),
    }),
  };
}

function compactEpisode(e, timeZone, details) {
  return {
    id: e.id,
    kind: e.kind,
    start: localTime(e.start, timeZone),
    ...(e.end && { end: localTime(e.end, timeZone) }),
    title: e.title,
    summary: e.summary,
    provider: e.provider,
    ...(details && { details: e.details }),
  };
}

/** YYYY-MM-DD de `value` en `timeZone`. */
export function localDate(value, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

/** "YYYY-MM-DD HH:mm" local: más fácil de leer para el modelo que un ISO en UTC. */
function localTime(iso, timeZone) {
  const value = new Date(iso);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
  return `${localDate(value, timeZone)} ${time}`;
}

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
