const num = (value) => (Number.isFinite(Number(value)) && value !== null ? Number(value) : null);
const LB_KG = 0.45359237;

/** Segundos unix (con decimales) → ISO, o null. */
function isoFromUnix(seconds) {
  const n = num(seconds);
  return n === null ? null : new Date(n * 1000).toISOString();
}

/** El peso de una serie en kg (Motra lo guarda en la unidad del usuario: kg o lb). */
function weightKg(weight) {
  const value = num(weight?.value);
  if (value === null) return null;
  const unit = String(weight.unit ?? 'kg').toLowerCase();
  if (unit === 'kg') return value;
  if (unit === 'lb' || unit === 'lbs') return Math.round(value * LB_KG * 100) / 100;
  return null;
}

/**
 * Los ejercicios de un entreno, en orden. Cada `activity` lleva
 * `strengthExercise.exercises[].setIDs`, que apuntan a `setMap`; cada serie dice su
 * `exerciseTypeID`, cuyo nombre y músculos están en `exerciseDetails`.
 */
function resolveExercises(workout) {
  const setMap = workout.setMap ?? {};
  const catalog = workout.exerciseDetails ?? {};
  const out = [];
  for (const activity of workout.activities ?? []) {
    for (const exercise of activity.strengthExercise?.exercises ?? []) {
      const raw = (exercise.setIDs ?? []).map((id) => setMap[id]).filter(Boolean);
      if (!raw.length) continue;
      const typeId = raw[0].exerciseTypeID ?? null;
      const detail = typeId ? catalog[typeId] : null;
      out.push({
        exerciseTypeID: typeId,
        name: detail?.name ?? typeId ?? 'Ejercicio',
        segment: activity.segment ?? null,
        primaryMuscleGroups: detail?.primaryMuscleGroups ?? [],
        secondaryMuscleGroups: detail?.secondaryMuscleGroups ?? [],
        equipmentGroups: detail?.equipmentGroups ?? [],
        // Series por tiempo (plancha...) no tienen reps; las de peso corporal, no tienen peso
        sets: raw.map((set) => ({
          reps: num(set.measurements?.reps),
          weightKg: weightKg(set.measurements?.weight),
          timeS: num(set.measurements?.time),
          restS: num(set.restTime),
        })),
      });
    }
  }
  return out;
}

/**
 * Un entreno de Motra → un episodio con sus ejercicios y series (reps, peso, descanso) y, de
 * resumen, series, repeticiones y volumen (Σ reps·kg). Modo 'exact': cada entreno es su propio
 * registro (por su workoutID) y lo que Motra deje de devolver no se borra. Sin observaciones: las
 * kcal ya llegan del reloj y no se cuentan dos veces.
 */
export function normalizeMotraWorkout(workout) {
  const start = isoFromUnix(workout?.timeStarted);
  if (!start) return { mode: 'exact', observations: [], episodes: [] };
  const end = isoFromUnix(workout.timeEnded);
  const exercises = resolveExercises(workout);

  let setCount = 0;
  let totalReps = 0;
  let volumeKg = 0;
  for (const set of exercises.flatMap((e) => e.sets)) {
    setCount++;
    totalReps += set.reps ?? 0;
    if (set.reps !== null && set.weightKg !== null) volumeKg += set.reps * set.weightKg;
  }
  const durationS = end ? Math.round((Date.parse(end) - Date.parse(start)) / 1000) : null;

  return {
    mode: 'exact',
    observations: [],
    episodes: [
      {
        origin: 'motra',
        originDetails: { source: 'motra', format: workout.workoutFormat ?? null },
        kind: 'workout',
        externalId: String(workout.workoutID),
        start,
        end,
        title: workout.name?.trim() || 'Entreno de fuerza',
        schema: 'motra.workout@1',
        summary: {
          // El tipo viene del índice (el provider lo copia); sin él, es un entreno de fuerza
          type: workout.activityType ?? 'traditionalStrengthTraining',
          durationS: durationS > 0 ? durationS : null,
          kcal: num(workout.statistics?.calories),
          exerciseCount: exercises.length,
          setCount,
          totalReps,
          volumeKg: volumeKg > 0 ? Math.round(volumeKg) : null,
          muscleGroups: [...new Set(exercises.flatMap((e) => e.primaryMuscleGroups))],
        },
        details: { exercises },
      },
    ],
  };
}
