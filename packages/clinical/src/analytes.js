/**
 * Catálogo de lo que se saca de los informes: parámetros de analítica, medidas del holter y de la
 * prueba de esfuerzo. Cada uno es una métrica del timeline (código propio, unidad UCUM, LOINC si
 * lo hay) con los nombres con que aparece en los informes y cómo pasar otras unidades a la suya.
 *
 * Los LOINC solo están cuando no hay duda de cuál es (un LOINC equivocado es peor que ninguno).
 */

/**
 * @typedef {{ code: string, label: string, unit: string | null, loinc: string | null,
 *   section: string, aliases: string[], convert?: Record<string, number> }} Analyte
 *   convert: unidad → factor para pasar a `unit` (valor × factor).
 */

const a = (code, label, unit, loinc, section, aliases, convert) =>
  Object.freeze({ code, label, unit, loinc, section, aliases, convert });

// mmol/L → mg/dL de los lípidos (colesterol: 38,67; triglicéridos: 88,57)
const CHOL = { 'mmol/L': 38.67 };

export const ANALYTES = Object.freeze([
  // Hemograma
  a('lab.erythrocytes', 'Hematíes', '10*6/uL', '789-8', 'Hemograma', [
    'hematies',
    'eritrocitos',
    'globulos rojos',
    'rbc',
    'recuento de hematies',
  ]),
  a('lab.hemoglobin', 'Hemoglobina', 'g/dL', '718-7', 'Hemograma', ['hemoglobina', 'hb', 'hgb'], {
    'g/L': 0.1,
  }),
  a('lab.hematocrit', 'Hematocrito', '%', '4544-3', 'Hemograma', ['hematocrito', 'hto', 'hct']),
  a('lab.mcv', 'VCM', 'fL', '787-2', 'Hemograma', ['volumen corpuscular medio', 'vcm', 'mcv']),
  a('lab.mch', 'HCM', 'pg', '785-6', 'Hemograma', ['hemoglobina corpuscular media', 'hcm', 'mch']),
  a(
    'lab.mchc',
    'CHCM',
    'g/dL',
    '786-4',
    'Hemograma',
    [
      'concentracion de hemoglobina corpuscular media',
      'conc hemoglobina corpuscular media',
      'chcm',
      'mchc',
    ],
    { 'g/L': 0.1 },
  ),
  a('lab.rdw', 'RDW', '%', '788-0', 'Hemograma', [
    'indice de anisocitosis',
    'amplitud de distribucion eritrocitaria',
    'ade',
    'rdw',
    'rdw-cv',
  ]),
  a('lab.leukocytes', 'Leucocitos', '10*3/uL', '6690-2', 'Hemograma', [
    'leucocitos',
    'globulos blancos',
    'wbc',
    'recuento de leucocitos',
  ]),
  a('lab.neutrophils_pct', '% Neutrófilos', '%', '770-8', 'Hemograma', [
    '% neutrofilos',
    'neutrofilos %',
    'neutrofilos (%)',
  ]),
  a('lab.lymphocytes_pct', '% Linfocitos', '%', '736-9', 'Hemograma', [
    '% linfocitos',
    'linfocitos %',
    'linfocitos (%)',
  ]),
  a('lab.monocytes_pct', '% Monocitos', '%', '5905-5', 'Hemograma', [
    '% monocitos',
    'monocitos %',
    'monocitos (%)',
  ]),
  a('lab.eosinophils_pct', '% Eosinófilos', '%', '713-8', 'Hemograma', [
    '% eosinofilos',
    'eosinofilos %',
    'eosinofilos (%)',
  ]),
  a('lab.basophils_pct', '% Basófilos', '%', '706-2', 'Hemograma', [
    '% basofilos',
    'basofilos %',
    'basofilos (%)',
  ]),
  a('lab.neutrophils', 'Neutrófilos', '10*3/uL', '751-8', 'Hemograma', [
    '# neutrofilos',
    'neutrofilos #',
    'neutrofilos absolutos',
    'neutrofilos',
  ]),
  a('lab.lymphocytes', 'Linfocitos', '10*3/uL', '731-0', 'Hemograma', [
    '# linfocitos',
    'linfocitos #',
    'linfocitos absolutos',
    'linfocitos',
  ]),
  a('lab.monocytes', 'Monocitos', '10*3/uL', '742-7', 'Hemograma', [
    '# monocitos',
    'monocitos #',
    'monocitos absolutos',
    'monocitos',
  ]),
  a('lab.eosinophils', 'Eosinófilos', '10*3/uL', '711-2', 'Hemograma', [
    '# eosinofilos',
    'eosinofilos #',
    'eosinofilos absolutos',
    'eosinofilos',
  ]),
  a('lab.basophils', 'Basófilos', '10*3/uL', '704-7', 'Hemograma', [
    '# basofilos',
    'basofilos #',
    'basofilos absolutos',
    'basofilos',
  ]),
  a('lab.platelets', 'Plaquetas', '10*3/uL', '777-3', 'Hemograma', [
    'plaquetas',
    'recuento de plaquetas',
    'plt',
  ]),
  a('lab.mpv', 'VPM', 'fL', '32623-1', 'Hemograma', ['volumen plaquetar medio', 'vpm', 'mpv']),

  // Bioquímica
  a(
    'lab.glucose',
    'Glucosa',
    'mg/dL',
    '2345-7',
    'Bioquímica',
    ['glucosa', 'glucosa basal', 'glucemia', 'glucosa en ayunas'],
    { 'mmol/L': 18.016 },
  ),
  a('lab.hba1c', 'Hemoglobina glicada', '%', '4548-4', 'Bioquímica', [
    'hemoglobina glicada',
    'hemoglobina glicosilada',
    'hba1c',
    'hb a1c',
  ]),
  a('lab.urea', 'Urea', 'mg/dL', '3091-6', 'Bioquímica', ['urea'], { 'mmol/L': 6.006 }),
  a('lab.creatinine', 'Creatinina', 'mg/dL', '2160-0', 'Bioquímica', ['creatinina'], {
    'umol/L': 1 / 88.42,
  }),
  a('lab.egfr', 'Filtrado glomerular', 'mL/min/{1.73_m2}', null, 'Bioquímica', [
    'filtrado glomerular estimado',
    'filtrado glomerular',
    'filtrado glomerular estimado (ckd-epi creatinina 2009)',
    'fge',
    'egfr',
    'ckd-epi',
  ]),
  a('lab.uric_acid', 'Ácido úrico', 'mg/dL', '3084-1', 'Bioquímica', ['acido urico', 'urato'], {
    'umol/L': 1 / 59.48,
  }),
  a(
    'lab.bilirubin_total',
    'Bilirrubina total',
    'mg/dL',
    '1975-2',
    'Bioquímica',
    ['bilirrubina total', 'bilirrubina'],
    { 'umol/L': 1 / 17.1 },
  ),
  a(
    'lab.bilirubin_direct',
    'Bilirrubina directa',
    'mg/dL',
    '1968-7',
    'Bioquímica',
    ['bilirrubina directa', 'bilirrubina conjugada'],
    { 'umol/L': 1 / 17.1 },
  ),
  a(
    'lab.bilirubin_indirect',
    'Bilirrubina indirecta',
    'mg/dL',
    '1971-1',
    'Bioquímica',
    ['bilirrubina indirecta', 'bilirrubina no conjugada'],
    { 'umol/L': 1 / 17.1 },
  ),
  a('lab.albumin', 'Albúmina', 'g/dL', '1751-7', 'Bioquímica', ['albumina', 'albumina suero'], {
    'g/L': 0.1,
  }),
  a('lab.total_protein', 'Proteínas totales', 'g/dL', '2885-2', 'Bioquímica', [
    'proteinas totales',
  ]),
  a('lab.crp', 'Proteína C reactiva', 'mg/L', '1988-5', 'Bioquímica', [
    'proteina c reactiva',
    'pcr',
    'crp',
  ]),

  // Iones
  a('lab.sodium', 'Sodio', 'mmol/L', '2951-2', 'Iones', ['sodio', 'na']),
  a('lab.potassium', 'Potasio', 'mmol/L', '2823-3', 'Iones', ['potasio', 'k']),
  a('lab.chloride', 'Cloro', 'mmol/L', '2075-0', 'Iones', ['cloro', 'cloruro', 'cl']),
  a('lab.phosphorus', 'Fósforo', 'mg/dL', '2777-1', 'Iones', ['fosforo', 'fosfato'], {
    'mmol/L': 3.097,
  }),
  a('lab.calcium', 'Calcio', 'mg/dL', '17861-6', 'Iones', ['calcio', 'calcio total'], {
    'mmol/L': 4.008,
  }),
  a(
    'lab.calcium_corrected',
    'Calcio corregido',
    'mg/dL',
    null,
    'Iones',
    ['calcio corregido por albumina', 'calcio corregido'],
    { 'mmol/L': 4.008 },
  ),
  a('lab.magnesium', 'Magnesio', 'mg/dL', '19123-9', 'Iones', ['magnesio'], { 'mmol/L': 2.431 }),

  // Lípidos
  a(
    'lab.cholesterol_total',
    'Colesterol total',
    'mg/dL',
    '2093-3',
    'Lípidos',
    ['colesterol total', 'colesterol'],
    CHOL,
  ),
  a(
    'lab.cholesterol_hdl',
    'HDL colesterol',
    'mg/dL',
    '2085-9',
    'Lípidos',
    ['hdl colesterol', 'colesterol hdl', 'hdl', 'hdl-c', 'c-hdl'],
    CHOL,
  ),
  a(
    'lab.cholesterol_ldl',
    'LDL colesterol',
    'mg/dL',
    null,
    'Lípidos',
    ['ldl colesterol', 'colesterol ldl', 'ldl', 'ldl-c', 'c-ldl', 'ldl calculado'],
    CHOL,
  ),
  a(
    'lab.cholesterol_non_hdl',
    'Colesterol no-HDL',
    'mg/dL',
    '43396-1',
    'Lípidos',
    ['colesterol no-hdl', 'colesterol no hdl', 'no-hdl'],
    CHOL,
  ),
  a('lab.triglycerides', 'Triglicéridos', 'mg/dL', '2571-8', 'Lípidos', ['trigliceridos', 'tg'], {
    'mmol/L': 88.57,
  }),
  a('lab.cholesterol_hdl_ratio', 'Índice colesterol/HDL', '1', '9830-1', 'Lípidos', [
    'indice col. total / hdl-col',
    'indice colesterol total/hdl',
    'indice col total / hdl col',
    'colesterol total/hdl',
    'indice aterogenico',
    'indice de castelli',
  ]),
  a('lab.ldl_hdl_ratio', 'Índice LDL/HDL', '1', '11054-4', 'Lípidos', [
    'indice ldl-col / hdl col',
    'indice ldl/hdl',
    'ldl/hdl',
  ]),
  a('lab.lipoprotein_a', 'Lipoproteína (a)', 'mg/dL', '10835-7', 'Lípidos', [
    'lipoproteina (a)',
    'lipoproteina a',
    'lp(a)',
    'lpa',
  ]),
  a('lab.apob', 'Apolipoproteína B', 'mg/dL', null, 'Lípidos', [
    'apolipoproteina b',
    'apo b',
    'apob',
  ]),

  // Enzimas
  a('lab.ast', 'AST (GOT)', 'U/L', '1920-8', 'Enzimas', ['asat (got)', 'asat', 'ast', 'got']),
  a('lab.alt', 'ALT (GPT)', 'U/L', '1742-6', 'Enzimas', ['alat (gpt)', 'alat', 'alt', 'gpt']),
  a('lab.ggt', 'Gamma-GT', 'U/L', '2324-2', 'Enzimas', [
    'gamma-gt',
    'gamma gt',
    'ggt',
    'gamma glutamil transferasa',
  ]),
  a('lab.alp', 'Fosfatasa alcalina', 'U/L', '6768-6', 'Enzimas', ['fosfatasa alcalina', 'fa']),
  a('lab.ldh', 'LDH', 'U/L', null, 'Enzimas', ['ldh', 'lactato deshidrogenasa']),
  a('lab.ck', 'CK', 'U/L', '2157-6', 'Enzimas', [
    'ck',
    'cpk',
    'creatina quinasa',
    'creatin kinasa',
  ]),

  // Hierro y vitaminas
  a('lab.iron', 'Hierro', 'ug/dL', '2498-4', 'Hierro', ['hierro', 'sideremia'], {
    'umol/L': 5.585,
  }),
  a('lab.ferritin', 'Ferritina', 'ng/mL', '2276-4', 'Hierro', ['ferritina'], { 'ug/L': 1 }),
  a('lab.transferrin', 'Transferrina', 'mg/dL', null, 'Hierro', ['transferrina']),
  a('lab.transferrin_saturation', 'Saturación de transferrina', '%', '2502-3', 'Hierro', [
    'saturacion de transferrina',
    'indice de saturacion de transferrina',
    'ist',
  ]),
  a(
    'lab.folate',
    'Ácido fólico',
    'ng/mL',
    '2284-8',
    'Vitaminas',
    ['acido folico (vitamina b9)', 'acido folico', 'folato', 'vitamina b9'],
    { 'nmol/L': 1 / 2.266 },
  ),
  a(
    'lab.vitamin_b12',
    'Vitamina B12',
    'pg/mL',
    '2132-9',
    'Vitaminas',
    ['vitamina b12', 'cianocobalamina', 'cobalamina'],
    { 'pmol/L': 1.355 },
  ),
  a(
    'lab.vitamin_d',
    'Vitamina D (25-OH)',
    'ng/mL',
    null,
    'Vitaminas',
    ['25-oh vitamina d', '25-hidroxivitamina d', 'vitamina d', 'vitamina d3', '25 oh vitamina d'],
    { 'nmol/L': 1 / 2.496 },
  ),

  // Hormonas
  a('lab.tsh', 'TSH', 'm[IU]/L', '3016-3', 'Hormonas', ['tsh', 'tirotropina']),
  a('lab.t4_free', 'T4 libre', 'ng/dL', null, 'Hormonas', ['t4 libre', 'tiroxina libre', 't4l']),
  a('lab.testosterone', 'Testosterona', 'ng/dL', null, 'Hormonas', [
    'testosterona',
    'testosterona total',
  ]),
  a('lab.cortisol', 'Cortisol', 'ug/dL', null, 'Hormonas', ['cortisol', 'cortisol basal']),

  // Marcadores cardiacos
  a('lab.nt_probnp', 'NT-proBNP', 'pg/mL', '33762-6', 'Marcadores cardiacos', [
    'nt-probnp',
    'nt probnp',
    'pro-bnp',
  ]),
  a('lab.troponin', 'Troponina', 'ng/L', null, 'Marcadores cardiacos', [
    'troponina',
    'troponina t',
    'troponina i',
    'troponina t ultrasensible',
  ]),
]);

/** Medidas del holter: `key` es la clave que devuelve el modelo. */
export const HOLTER_MEASURES = Object.freeze([
  m('hr_min', 'FC mínima', '/min'),
  m('hr_avg', 'FC media', '/min'),
  m('hr_max', 'FC máxima', '/min'),
  m('hr_night', 'FC nocturna', '/min'),
  m('beats_total', 'Latidos totales', '1'),
  m('recorded_minutes', 'Tiempo analizado', 'min'),
  m('sdnn', 'SDNN', 'ms'),
  m('sdann', 'SDANN', 'ms'),
  m('sdnn_index', 'Índice SDNN (SDNN5)', 'ms'),
  m('rmssd', 'RMSSD', 'ms'),
  m('pnn50', 'pNN50', '%'),
  m('triangular_index', 'Índice triangular', '1'),
  m('sve_total', 'Extrasístoles supraventriculares', '1'),
  m('sve_couplets', 'Duplas supraventriculares', '1'),
  m('svt_runs', 'Rachas de TSV', '1'),
  m('ve_total', 'Extrasístoles ventriculares', '1'),
  m('ve_couplets', 'Duplas ventriculares', '1'),
  m('vt_runs', 'Rachas de TV', '1'),
  m('pauses', 'Pausas > 2 s', '1'),
  m('brady_events', 'Episodios de bradicardia', '1'),
  m('af_percent', 'Fibrilación auricular', '%'),
  m('qt_min', 'QT mínimo', 'ms'),
  m('qt_max', 'QT máximo', 'ms'),
  m('qtc', 'QTc', 'ms'),
]).map((measure) => ({ ...measure, code: `holter.${measure.key}` }));

/**
 * Medidas de la prueba de esfuerzo (ergometría o ergoespirometría). El VO2max medido va a la misma
 * métrica que el del reloj: con la prioridad de la fuente clínica, el medido manda.
 */
export const STRESS_TEST_MEASURES = Object.freeze([
  m('vo2max', 'VO2max', 'mL/kg/min', 'fitness.vo2max'),
  m('vo2max_abs', 'VO2max absoluto', 'mL/min'),
  m('vo2max_predicted_pct', 'VO2max sobre el teórico', '%'),
  m('hr_rest', 'FC en reposo', '/min'),
  m('hr_max', 'FC máxima', '/min'),
  m('hr_max_predicted_pct', 'FC máxima sobre la teórica', '%'),
  m('hr_recovery_1min', 'Recuperación de la FC (1 min)', '/min'),
  m('vt1_hr', 'Umbral aeróbico (VT1): FC', '/min'),
  m('vt1_vo2', 'Umbral aeróbico (VT1): VO2', 'mL/kg/min'),
  m('vt1_power', 'Umbral aeróbico (VT1): potencia', 'W'),
  m('vt1_speed', 'Umbral aeróbico (VT1): velocidad', 'km/h'),
  m('vt2_hr', 'Umbral anaeróbico (VT2): FC', '/min'),
  m('vt2_vo2', 'Umbral anaeróbico (VT2): VO2', 'mL/kg/min'),
  m('vt2_power', 'Umbral anaeróbico (VT2): potencia', 'W'),
  m('vt2_speed', 'Umbral anaeróbico (VT2): velocidad', 'km/h'),
  m('max_power', 'Potencia máxima', 'W'),
  m('max_speed', 'Velocidad máxima', 'km/h'),
  m('max_slope', 'Pendiente máxima', '%'),
  m('mets_max', 'METs máximos', '1'),
  m('rer_max', 'Cociente respiratorio máximo', '1'),
  m('duration_min', 'Duración del esfuerzo', 'min'),
  m('bp_rest_sys', 'TA en reposo (sistólica)', 'mm[Hg]'),
  m('bp_rest_dia', 'TA en reposo (diastólica)', 'mm[Hg]'),
  m('bp_max_sys', 'TA máxima (sistólica)', 'mm[Hg]'),
  m('bp_max_dia', 'TA máxima (diastólica)', 'mm[Hg]'),
]).map((measure) => ({ ...measure, code: measure.code ?? `stress.${measure.key}` }));

function m(key, label, unit, code) {
  return { key, label, unit, code };
}

/**
 * Todas las métricas que pueden salir de un informe, para el catálogo del timeline (los
 * parámetros de analítica y las medidas son "un valor en un momento": agregación 'last').
 */
export const CLINICAL_METRICS = Object.freeze([
  ...ANALYTES.map(({ code, unit, label, loinc }) => ({ code, unit, label, loinc })),
  ...HOLTER_MEASURES.map(({ code, unit, label }) => ({ code, unit, label: `Holter: ${label}` })),
  ...STRESS_TEST_MEASURES.filter((s) => s.code.startsWith('stress.')).map(
    ({ code, unit, label }) => ({ code, unit, label: `Esfuerzo: ${label}` }),
  ),
]);

const BY_CODE = new Map(ANALYTES.map((analyte) => [analyte.code, analyte]));
const BY_ALIAS = new Map();
for (const analyte of ANALYTES) {
  for (const alias of [analyte.label, ...analyte.aliases]) {
    const key = normalizeName(alias);
    // El primero gana: los alias genéricos ("neutrofilos") van detrás de los específicos
    if (!BY_ALIAS.has(key)) BY_ALIAS.set(key, analyte);
  }
}

export function getAnalyte(code) {
  return BY_CODE.get(code) ?? null;
}

/** Nombre comparable: sin tildes, minúsculas, sin puntuación sobrante ni espacios dobles. */
export function normalizeName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[.:;]/g, ' ')
    .replace(/\s*([/()-])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * El parámetro del catálogo para un nombre tal como sale en el informe: el nombre entero, sin lo
 * que va entre paréntesis o solo lo de dentro ("Volumen corpuscular medio (VCM)").
 * @param {string} name
 * @param {Map<string, string>} [aliases]  Los que ha confirmado el usuario: nombre normalizado → código.
 */
export function findAnalyte(name, aliases) {
  const full = normalizeName(name);
  const own = aliases?.get(full);
  if (own) return BY_CODE.get(own) ?? { code: own, custom: true };
  const inside = /\(([^)]+)\)/.exec(full)?.[1];
  const outside = full.replace(/\([^)]*\)/g, '').trim();
  for (const key of [full, outside, inside].filter(Boolean)) {
    const found = BY_ALIAS.get(key);
    if (found) return found;
  }
  return null;
}

/** Unidades como las escriben los laboratorios → UCUM. */
const UNITS = new Map(
  Object.entries({
    'mg/dl': 'mg/dL',
    'g/dl': 'g/dL',
    'g/l': 'g/L',
    'mg/l': 'mg/L',
    'ug/dl': 'ug/dL',
    'µg/dl': 'ug/dL',
    'mcg/dl': 'ug/dL',
    'ug/l': 'ug/L',
    'µg/l': 'ug/L',
    'ng/ml': 'ng/mL',
    'ng/dl': 'ng/dL',
    'ng/l': 'ng/L',
    'pg/ml': 'pg/mL',
    'mmol/l': 'mmol/L',
    'meq/l': 'mmol/L',
    'umol/l': 'umol/L',
    'µmol/l': 'umol/L',
    'nmol/l': 'nmol/L',
    'pmol/l': 'pmol/L',
    'u/l': 'U/L',
    'ui/l': 'U/L',
    'iu/l': 'U/L',
    'mui/l': 'm[IU]/L',
    'miu/l': 'm[IU]/L',
    'µui/ml': 'm[IU]/L',
    'uui/ml': 'm[IU]/L',
    'µu/ml': 'm[IU]/L',
    fl: 'fL',
    pg: 'pg',
    '%': '%',
    '10e6/µl': '10*6/uL',
    '10e6/ul': '10*6/uL',
    '10^6/µl': '10*6/uL',
    '10^6/ul': '10*6/uL',
    'x10e6/µl': '10*6/uL',
    'x10^6/µl': '10*6/uL',
    'mill/mm3': '10*6/uL',
    'millones/mm3': '10*6/uL',
    '10e3/µl': '10*3/uL',
    '10e3/ul': '10*3/uL',
    '10^3/µl': '10*3/uL',
    '10^3/ul': '10*3/uL',
    'x10e3/µl': '10*3/uL',
    'x10^3/µl': '10*3/uL',
    'mil/mm3': '10*3/uL',
    'miles/mm3': '10*3/uL',
    '10e9/l': '10*3/uL',
    '10^9/l': '10*3/uL',
    'x10e9/l': '10*3/uL',
    '10e12/l': '10*6/uL',
    '10^12/l': '10*6/uL',
    'ml/min/1.73m^2': 'mL/min/{1.73_m2}',
    'ml/min/1.73m2': 'mL/min/{1.73_m2}',
    'ml/min/1,73m2': 'mL/min/{1.73_m2}',
    'ml/min/1.73 m2': 'mL/min/{1.73_m2}',
    lpm: '/min',
    'lat/min': '/min',
    bpm: '/min',
    ms: 'ms',
    'ml/kg/min': 'mL/kg/min',
    'ml/min/kg': 'mL/kg/min',
    'ml/min': 'mL/min',
    w: 'W',
    watios: 'W',
    'km/h': 'km/h',
    mmhg: 'mm[Hg]',
    min: 'min',
  }),
);

/** La unidad del informe en UCUM (null si no la conocemos). */
export function normalizeUnit(unit) {
  if (unit == null) return null;
  const key = String(unit).trim().toLowerCase().replace(/\s+/g, '').replace('μ', 'µ');
  if (!key) return null;
  return UNITS.get(key) ?? UNITS.get(String(unit).trim().toLowerCase()) ?? null;
}

/**
 * Un valor en la unidad del parámetro. Sin unidad en el informe se da por buena la del catálogo;
 * con otra unidad sin conversión conocida devuelve null (hay que revisarlo).
 * @returns {{ value: number, unit: string } | null}
 */
export function toAnalyteUnit(analyte, value, unit) {
  if (value == null || !Number.isFinite(value)) return null;
  if (!analyte.unit) return { value, unit: normalizeUnit(unit) ?? unit ?? null };
  // Sin unidad en el informe (los índices, o la columna vacía): la del catálogo
  if (!String(unit ?? '').trim()) return { value, unit: analyte.unit };
  const from = normalizeUnit(unit);
  if (from === analyte.unit) return { value, unit: analyte.unit };
  const factor = from && analyte.convert?.[from];
  if (factor) return { value: round(value * factor, 4), unit: analyte.unit };
  return null;
}

function round(value, digits) {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}
