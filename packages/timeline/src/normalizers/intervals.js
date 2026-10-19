import { localMidnight } from '../time.js';

const num = (value) => (Number.isFinite(Number(value)) && value !== null ? Number(value) : null);
// El origen de cada actividad: de dónde le llegó a intervals.icu (GARMIN_CONNECT, UPLOAD, ZWIFT...)
const originOf = (activity) => String(activity.source ?? 'intervals').toLowerCase();

/**
 * Una actividad de intervals.icu → un entreno (episodio) y su carga (TSS) como observación.
 * Modo 'exact': cada actividad es su propio registro; si intervals deja de devolverla (p. ej. si
 * corta lo de Garmin) aquí no se borra nada.
 */
export function normalizeIntervalsActivity(activity) {
  const start = activity.start_date ? new Date(activity.start_date) : null;
  if (!start || Number.isNaN(start.getTime()))
    return { mode: 'exact', observations: [], episodes: [] };
  const seconds = num(activity.elapsed_time) ?? num(activity.moving_time);
  const end = seconds ? new Date(start.getTime() + seconds * 1000).toISOString() : null;
  const origin = originOf(activity);
  const originDetails = { source: activity.source ?? null, device: activity.device_name ?? null };
  const tss = num(activity.icu_training_load);

  return {
    mode: 'exact',
    observations:
      tss === null
        ? []
        : [
            {
              origin,
              originDetails,
              metric: 'training.load',
              time: start.toISOString(),
              value: tss,
            },
          ],
    episodes: [
      {
        origin,
        originDetails,
        kind: 'workout',
        externalId: String(activity.id),
        start: start.toISOString(),
        end,
        title: activity.name ?? activity.type ?? 'Entreno',
        schema: 'icu.activity@1',
        summary: {
          type: activity.type ?? null,
          durationS: num(activity.moving_time),
          distanceM: num(activity.distance),
          kcal: num(activity.calories),
          avgHeartRate: num(activity.average_heartrate),
          maxHeartRate: num(activity.max_heartrate),
          tss,
          intensity: num(activity.icu_intensity),
          avgPower: num(activity.icu_average_watts),
          normalizedPower: num(activity.icu_weighted_avg_watts),
          elevationM: num(activity.total_elevation_gain),
          trainer: activity.trainer ?? null,
        },
        details: activity,
      },
    ],
  };
}

const WELLNESS = [
  ['training.ctl', 'ctl'],
  ['training.atl', 'atl'],
  ['training.ramp', 'rampRate'],
];

/**
 * Un día de wellness → CTL, ATL y rampa (lo que calcula intervals.icu). FC en reposo, VFC, sueño
 * o peso no se cogen de aquí: ya llegan de su fuente (Apple Watch, báscula) y mandan esas.
 * Va a medianoche local de su fecha y es la verdad de ese día local (modo 'range').
 */
export function normalizeIntervalsWellness(day, { timeZone }) {
  const date = day.id;
  const from = localMidnight(date, timeZone);
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const time = from.toISOString();
  const origin = 'intervals';
  const observations = [];
  for (const [metric, field] of WELLNESS) {
    const value = num(day[field]);
    if (value !== null) observations.push({ origin, originDetails: {}, metric, time, value });
  }
  return {
    mode: 'range',
    metrics: WELLNESS.map(([metric]) => metric),
    range: { from: time, to: localMidnight(next, timeZone).toISOString() },
    observations,
    episodes: [],
  };
}
