/** Entrenos: el evento del día, la tabla de fuerza y la fila de la lista de Entrenos. */
import { minutesOfDay, toISODate } from '../../../lib/dates.js';
import { fmtDec, fmtDuration, fmtInt } from '../../../lib/format.js';
import { round1, sourceOf } from './common.js';

// Tipos de Google (BIKING...) y de intervals.icu (Ride, MountainBikeRide...)
const WORKOUT_ICON = {
  BIKING: 'Bike',
  RUNNING: 'Footprints',
  WALKING: 'PersonStanding',
  HIKING: 'PersonStanding',
  STRENGTH_TRAINING: 'Dumbbell',
  WEIGHTLIFTING: 'Dumbbell',
  traditionalStrengthTraining: 'Dumbbell',
  functionalStrengthTraining: 'Dumbbell',
  Ride: 'Bike',
  MountainBikeRide: 'Bike',
  GravelRide: 'Bike',
  VirtualRide: 'Bike',
  EBikeRide: 'Bike',
  Run: 'Footprints',
  TrailRun: 'Footprints',
  VirtualRun: 'Footprints',
  Walk: 'PersonStanding',
  Hike: 'PersonStanding',
  WeightTraining: 'Dumbbell',
};

const kgText = (kg) => `${fmtDec(kg, kg % 1 ? 1 : 0)} kg`;

/**
 * Los ejercicios de un entreno de fuerza (Motra) para la tabla del lateral: cada serie lleva sus
 * reps y su peso, así que se enseñan tal cual ("10 · 8 · 8") y la carga como rango si cambia.
 */
export function strengthExercises(episode) {
  return (episode.details?.exercises ?? []).map((x) => {
    const sets = x.sets ?? [];
    const reps = sets.map((s) => s.reps).filter((r) => r != null);
    const kgs = sets.map((s) => s.weightKg).filter((kg) => kg != null && kg > 0);
    const secs = sets.map((s) => s.timeS).filter((t) => t != null && t > 0);
    const min = Math.min(...kgs);
    const max = Math.max(...kgs);
    return {
      name: x.name,
      sets: sets.length,
      // Las series por tiempo (plancha) no tienen reps: su duración
      reps: reps.length
        ? reps.join(' · ')
        : secs.map((t) => `${Math.round(t)} s`).join(' · ') || '—',
      load: !kgs.length
        ? 'Peso corporal'
        : min === max
          ? kgText(min)
          : `${fmtDec(min, min % 1 ? 1 : 0)}–${kgText(max)}`,
      muscles: x.primaryMuscleGroups ?? [],
    };
  });
}

export function workoutEvent(episode) {
  const s = episode.summary ?? {};
  const minutes = s.durationS
    ? Math.round(s.durationS / 60)
    : episode.end
      ? Math.round((new Date(episode.end) - new Date(episode.start)) / 60_000)
      : null;
  const km = s.distanceM ? round1(s.distanceM / 1000) : null;
  const exercises = strengthExercises(episode);
  const parts = [
    minutes && fmtDuration(minutes),
    km && `${fmtDec(km, 1)} km`,
    s.setCount && `${s.setCount} series`,
    s.volumeKg && `${fmtInt(s.volumeKg)} kg de volumen`,
    s.avgHeartRate && `${Math.round(s.avgHeartRate)} ppm`,
    s.tss && `TSS ${Math.round(s.tss)}`,
  ].filter(Boolean);
  const start = minutesOfDay(new Date(episode.start));
  return {
    id: episode.id,
    category: 'activity',
    icon: WORKOUT_ICON[s.type] ?? 'Activity',
    title: episode.title,
    subtitle: parts.join(' · '),
    start,
    end: episode.end
      ? start + Math.round((new Date(episode.end) - new Date(episode.start)) / 60_000)
      : undefined,
    metrics: [
      { label: 'Duración', value: minutes, unit: 'min' },
      { label: 'Distancia', value: km, unit: 'km', digits: 1 },
      { label: 'Ejercicios', value: s.exerciseCount || null },
      { label: 'Series', value: s.setCount || null },
      { label: 'Repeticiones', value: s.totalReps || null },
      { label: 'Volumen', value: s.volumeKg || null, unit: 'kg' },
      { label: 'FC media', value: s.avgHeartRate && Math.round(s.avgHeartRate), unit: 'ppm' },
      { label: 'TSS', value: s.tss && Math.round(s.tss) },
      { label: 'Calorías', value: s.kcal && Math.round(s.kcal), unit: 'kcal' },
      { label: 'Potencia media', value: s.avgPower && Math.round(s.avgPower), unit: 'W' },
      {
        label: 'Potencia normalizada',
        value: s.normalizedPower && Math.round(s.normalizedPower),
        unit: 'W',
      },
    ].filter((m) => m.value != null),
    ...(exercises.length && { workout: { exercises } }),
    sources: [
      {
        source: sourceOf(episode),
        primary: true,
        externalId: episode.id,
        recordedAt: episode.end ?? episode.start,
        values: { ...s, origen: episode.origin?.application ?? '' },
      },
    ],
  };
}

const SPORT_LABEL = {
  Bike: 'Ciclismo',
  Footprints: 'Carrera',
  PersonStanding: 'Caminata',
  Dumbbell: 'Fuerza',
};

/**
 * Un entreno real para la lista de Entrenos: con el mismo id que su evento del día, así el enlace
 * lleva al día y lo abre en el lateral.
 */
export function activityFrom(episode) {
  const s = episode.summary ?? {};
  const event = workoutEvent(episode);
  const minutes = event.metrics.find((m) => m.label === 'Duración')?.value ?? 0;
  const distanceKm = s.distanceM ? round1(s.distanceM / 1000) : null;
  const running = event.icon === 'Footprints';
  return {
    id: event.id,
    date: toISODate(new Date(episode.start)),
    start: event.start,
    title: episode.title,
    icon: event.icon,
    sportLabel: SPORT_LABEL[event.icon] ?? 'Entreno',
    minutes,
    distanceKm,
    paceSecPerKm: running && distanceKm ? Math.round((minutes * 60) / distanceKm) : null,
    avgPower: s.avgPower ? Math.round(s.avgPower) : null,
    avgHr: s.avgHeartRate ? Math.round(s.avgHeartRate) : null,
    tss: s.tss ? Math.round(s.tss) : null,
  };
}
