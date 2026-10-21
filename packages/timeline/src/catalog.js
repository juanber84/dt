import { CLINICAL_METRICS } from '@digitaltwin/clinical';

/**
 * Catálogo de métricas del timeline. Códigos propios (estables, independientes de la fuente),
 * unidades UCUM y LOINC cuando lo hay. Cada fuente traduce lo suyo a estos códigos.
 *
 * aggregation: cómo se resume en el tiempo
 *   avg   valores que se promedian (FC, peso...)
 *   sum   cantidades que se suman (pasos, kcal...)
 *   last  un valor por periodo (VO2max diario, FC en reposo...)
 */
export const METRICS = Object.freeze(
  [
    // Composición corporal
    m('body.weight', 'kg', 'avg', 'Peso', '29463-7'),
    m('body.fat_percent', '%', 'avg', 'Grasa corporal', '41982-0'),
    m('body.bmi', 'kg/m2', 'avg', 'IMC', '39156-5'),
    m('body.height', 'm', 'last', 'Altura', '8302-2'),
    m('body.fat_mass', 'kg', 'avg', 'Masa grasa'),
    m('body.lean_mass', 'kg', 'avg', 'Masa libre de grasa'),
    m('body.water_percent', '%', 'avg', 'Agua corporal'),
    m('body.water_mass', 'kg', 'avg', 'Masa de agua'),
    m('body.muscle_mass', 'kg', 'avg', 'Masa muscular'),
    m('body.muscle_percent', '%', 'avg', 'Músculo'),
    m('body.skeletal_muscle_mass', 'kg', 'avg', 'Músculo esquelético'),
    m('body.smi', 'kg/m2', 'avg', 'Índice músculo esquelético'),
    m('body.bone_mass', 'kg', 'avg', 'Masa ósea'),
    m('body.bone_percent', '%', 'avg', 'Hueso'),
    m('body.protein_mass', 'kg', 'avg', 'Proteína'),
    m('body.protein_percent', '%', 'avg', 'Proteína'),
    m('body.visceral_fat', '1', 'avg', 'Grasa visceral'),
    m('body.basal_metabolism', 'kcal/d', 'avg', 'Metabolismo basal'),
    m('body.metabolic_age', 'a', 'avg', 'Edad metabólica'),
    m('body.physique_rating', '1', 'last', 'Tipo de cuerpo'),
    m('body.score', '1', 'avg', 'Puntuación corporal'),
    m('body.ideal_weight', 'kg', 'last', 'Peso ideal'),
    m('body.weight_control', 'kg', 'last', 'Control de peso'),
    m('body.fat_control', 'kg', 'last', 'Control de grasa'),
    m('body.muscle_control', 'kg', 'last', 'Control de músculo'),
    m('body.waist_hip_ratio', '1', 'avg', 'Ratio cintura-cadera'),
    m('body.impedance_low', 'Ohm', 'avg', 'Impedancia baja frecuencia'),
    m('body.impedance_high', 'Ohm', 'avg', 'Impedancia alta frecuencia'),
    m('body.temperature', 'Cel', 'avg', 'Temperatura corporal', '8310-5'),
    m('body.sleep_temperature', 'Cel', 'last', 'Temperatura nocturna'),
    // Corazón y respiración
    m('heart.rate', '/min', 'avg', 'Frecuencia cardíaca', '8867-4'),
    m('heart.resting_rate', '/min', 'last', 'FC en reposo', '40443-4'),
    m('heart.hrv_rmssd', 'ms', 'avg', 'VFC (RMSSD)'),
    m('heart.hrv_sdnn', 'ms', 'avg', 'VFC (SDNN)'),
    m('heart.hrv_daily', 'ms', 'last', 'VFC diaria'),
    m('blood.oxygen_saturation', '%', 'avg', 'SpO₂', '59408-5'),
    m('blood.oxygen_saturation_daily', '%', 'last', 'SpO₂ diaria'),
    m('blood.glucose', 'mg/dL', 'avg', 'Glucosa', '2339-0'),
    m('respiration.rate_daily', '/min', 'last', 'Frecuencia respiratoria', '9279-1'),
    m('fitness.vo2max', 'mL/kg/min', 'last', 'VO2max'),
    // Carga de entrenamiento (intervals.icu): TSS de cada entreno y CTL/ATL del día
    m('training.load', '1', 'sum', 'Carga (TSS)'),
    m('training.ctl', '1', 'last', 'Fitness (CTL)'),
    m('training.atl', '1', 'last', 'Fatiga (ATL)'),
    m('training.ramp', '1', 'last', 'Rampa de CTL'),
    // Actividad
    m('activity.steps', '1', 'sum', 'Pasos', '55423-8'),
    m('activity.distance', 'm', 'sum', 'Distancia'),
    m('activity.floors', '1', 'sum', 'Pisos'),
    m('activity.elevation_gain', 'm', 'sum', 'Desnivel'),
    m('activity.active_zone_minutes', 'min', 'sum', 'Minutos en zona'),
    m('energy.active', 'kcal', 'sum', 'Energía activa'),
    m('energy.basal', 'kcal', 'sum', 'Energía basal'),
    // Nutrición (lo que se come)
    m('intake.energy', 'kcal', 'sum', 'Energía ingerida'),
    m('intake.protein', 'g', 'sum', 'Proteína'),
    m('intake.carbs', 'g', 'sum', 'Hidratos'),
    m('intake.fat', 'g', 'sum', 'Grasa'),
    m('intake.fiber', 'g', 'sum', 'Fibra'),
    m('intake.water', 'mL', 'sum', 'Agua'),
    m('intake.caffeine', 'mg', 'sum', 'Cafeína'),
    // Informes médicos (analíticas, holter, prueba de esfuerzo): un valor por prueba
    ...CLINICAL_METRICS.map((c) => m(c.code, c.unit, 'last', c.label, c.loinc ?? null)),
  ].map(Object.freeze),
);

function m(code, unit, aggregation, label, loinc = null) {
  return { code, unit, aggregation, label, loinc };
}

const BY_CODE = new Map(METRICS.map((metric) => [metric.code, metric]));

export function getMetric(code) {
  return BY_CODE.get(code) ?? null;
}

/**
 * Ids de las métricas en la BD (smallint, para que observations sea estrecha). Al arrancar da de
 * alta las del catálogo; las desconocidas que traiga una fuente se crean al vuelo (sin unidad,
 * agregación 'avg') para no perder datos.
 * @param {import('postgres').Sql} db
 */
export function createCatalog(db) {
  const ids = new Map();
  const byId = new Map();
  let ready;

  async function load() {
    for (const metric of METRICS) {
      await db`
        insert into metrics (code, unit, aggregation, label, loinc)
        values (${metric.code}, ${metric.unit}, ${metric.aggregation}, ${metric.label}, ${metric.loinc})
        on conflict (code) do update set
          unit = excluded.unit, aggregation = excluded.aggregation,
          label = excluded.label, loinc = excluded.loinc
      `;
    }
    for (const row of await db`select * from metrics`) remember(row);
  }

  function remember(row) {
    const metric = {
      id: row.id,
      code: row.code,
      unit: row.unit,
      aggregation: row.aggregation,
      label: row.label,
    };
    ids.set(row.code, metric);
    byId.set(row.id, metric);
  }

  return {
    async ready() {
      ready ??= load().catch((err) => {
        ready = undefined;
        throw err;
      });
      return ready;
    },

    /** Id de la métrica; la crea si no existe. */
    async id(code, { unit = null, aggregation = 'avg', label = null } = {}) {
      await this.ready();
      if (ids.has(code)) return ids.get(code).id;
      const [row] = await db`
        insert into metrics (code, unit, aggregation, label)
        values (${code}, ${unit}, ${aggregation}, ${label})
        on conflict (code) do update set code = excluded.code
        returning *
      `;
      remember(row);
      return row.id;
    },

    /** Métrica por código (solo las ya cargadas). */
    async get(code) {
      await this.ready();
      return ids.get(code) ?? null;
    },

    async byId(id) {
      await this.ready();
      return byId.get(id) ?? null;
    },

    async list() {
      await this.ready();
      return [...ids.values()];
    },
  };
}
