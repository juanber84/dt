import { parseMeasurement } from '@digitaltwin/xiaomi';

/** Métrica de la báscula (SCALE_METRICS de @digitaltwin/xiaomi) → código del catálogo. */
export const XIAOMI_METRICS = Object.freeze({
  weight: 'body.weight',
  bmi: 'body.bmi',
  bodyFat: 'body.fat_percent',
  fatMass: 'body.fat_mass',
  leanBodyMass: 'body.lean_mass',
  bodyWater: 'body.water_percent',
  bodyWaterMass: 'body.water_mass',
  muscleMass: 'body.muscle_mass',
  musclePercent: 'body.muscle_percent',
  skeletalMuscleMass: 'body.skeletal_muscle_mass',
  smi: 'body.smi',
  boneMass: 'body.bone_mass',
  bonePercent: 'body.bone_percent',
  proteinMass: 'body.protein_mass',
  proteinPercent: 'body.protein_percent',
  visceralFat: 'body.visceral_fat',
  basalMetabolism: 'body.basal_metabolism',
  metabolicAge: 'body.metabolic_age',
  physiqueRating: 'body.physique_rating',
  bodyScore: 'body.score',
  idealWeight: 'body.ideal_weight',
  weightControl: 'body.weight_control',
  fatControl: 'body.fat_control',
  muscleControl: 'body.muscle_control',
  waistHipRatio: 'body.waist_hip_ratio',
  heartRate: 'heart.rate',
  impedanceLow: 'body.impedance_low',
  impedanceHigh: 'body.impedance_high',
});

/**
 * Un registro crudo de la báscula (tal cual lo devuelve Xiaomi) → un pesaje (episodio con toda
 * la composición corporal) y una observación por cada métrica que traiga.
 */
export function normalizeXiaomiScale(payload) {
  const measurement = parseMeasurement(payload);
  if (!measurement.timestamp) return { mode: 'exact', observations: [], episodes: [] };

  const time = new Date(measurement.timestamp).toISOString();
  const origin = `${measurement.model ?? 'scale'}:${measurement.did ?? 'unknown'}`;
  const originDetails = { model: measurement.model, did: measurement.did, kind: 'scale' };
  const values = {};
  const observations = [];
  for (const [key, code] of Object.entries(XIAOMI_METRICS)) {
    const value = measurement[key];
    if (value === null || value === undefined) continue;
    values[key] = value;
    observations.push({ origin, originDetails, metric: code, time, value });
  }

  return {
    mode: 'exact',
    observations,
    episodes: [
      {
        origin,
        originDetails,
        kind: 'weigh-in',
        externalId: measurement.id,
        start: time,
        end: null,
        title: values.weight ? `${values.weight} kg` : 'Pesaje',
        summary: { weight: values.weight ?? null, bodyFat: values.bodyFat ?? null },
        schema: 'weigh-in@1',
        details: {
          ...values,
          user: measurement.user,
          height: measurement.height,
          profile: measurement.profile,
          fromSource: measurement.fromSource,
        },
      },
    ],
  };
}
