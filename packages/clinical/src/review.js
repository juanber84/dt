import {
  ANALYTES,
  HOLTER_MEASURES,
  STRESS_TEST_MEASURES,
  findAnalyte,
  normalizeName,
  normalizeUnit,
  toAnalyteUnit,
} from './analytes.js';
import { extractionSchema } from './schema.js';

export const TITLES = Object.freeze({
  lab: 'Analítica',
  holter: 'Holter',
  stress_test: 'Prueba de esfuerzo',
  ecg: 'Electrocardiograma',
  imaging: 'Prueba de imagen',
  other_test: 'Prueba médica',
  report: 'Informe médico',
});

/** Sección de las medidas de cada prueba (en la revisión y en los parámetros). */
export const MEASURE_SECTIONS = Object.freeze({
  holter: 'Holter',
  stress_test: 'Prueba de esfuerzo',
  ecg: 'ECG',
  imaging: 'Imagen',
  other_test: 'Pruebas',
  report: 'Informes',
});

const MEASURES = {
  holter: new Map(HOLTER_MEASURES.map((m) => [m.key, m])),
  stress_test: new Map(STRESS_TEST_MEASURES.map((m) => [m.key, m])),
};
const BY_CODE = new Map(
  [...ANALYTES, ...HOLTER_MEASURES, ...STRESS_TEST_MEASURES].map((m) => [m.code, m]),
);

/**
 * Métrica propia para lo que no está en el catálogo (un parámetro raro de una analítica, una
 * medida sin clave conocida): lab.custom.<nombre>, holter.<clave>, stress.<clave>.
 */
export function customMetricCode(type, item) {
  const slug = normalizeName(item.key ?? item.name)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  if (type === 'lab') return `lab.custom.${slug}`;
  if (type === 'holter') return `holter.${slug}`;
  if (type === 'stress_test') return `stress.${slug}`;
  if (type === 'ecg') return `ecg.${slug}`;
  return `clinical.${slug}`;
}

/** Lo que sabemos de una métrica del catálogo clínico (unidad, nombre, conversiones). */
export function clinicalMetric(code) {
  return BY_CODE.get(code) ?? null;
}

/**
 * La salida del modelo → documento revisable: cada valor comprobado contra el texto que vio el
 * modelo (un número que no está en el informe se marca 'unverified'), con su métrica del timeline
 * y el valor ya en la unidad de esa métrica.
 * @param {import('zod').infer<typeof import('./schema.js').modelOutputSchema>} output
 * @param {string} text  El texto que se le mandó al modelo (ya sin datos personales).
 * @param {{ aliases?: Map<string, string>, fallbackDate?: string | null, ocr?: boolean }} [options]
 *   aliases: nombre normalizado → métrica, confirmados. fallbackDate: el día desde el que se subió,
 *   para cuando el informe no trae fecha (se queda marcado 'date-unverified' para revisarlo).
 */
export function buildExtraction(output, text, { aliases, fallbackDate = null, ocr = false } = {}) {
  const type = output.type;
  const start = minute(output.start);
  const end = minute(output.end);
  const date = output.date ?? start?.slice(0, 10) ?? fallbackDate ?? null;

  const fromItems = output.items.map((item) => ({
    section: item.section,
    name: item.name,
    text: item.value_text,
    value: item.value,
    unit: item.unit,
    rangeText: item.range_text,
    rangeMin: item.range_min,
    rangeMax: item.range_max,
    flag: item.flag,
    comment: item.comment,
  }));
  const fromMeasures = output.measures.map((measure) => {
    const known = MEASURES[type]?.get(measure.key);
    return {
      section: MEASURE_SECTIONS[type] ?? '',
      name: known?.label ?? (measure.name || measure.key),
      key: measure.key,
      text: measure.value_text,
      value: measure.value,
      unit: measure.unit,
      metric: known?.code ?? null,
    };
  });

  const extraction = {
    type,
    title: output.title || TITLES[type],
    center: output.center,
    date,
    start,
    end,
    summary: output.summary,
    items: [...fromItems, ...fromMeasures].map((item, index) => ({ id: `i${index + 1}`, ...item })),
    hourly: hourlyRows(output.hourly, start),
    report: output.report && {
      kind: output.report.kind,
      specialty: output.report.specialty,
      diagnosis: output.report.diagnosis,
      bodyPart: output.report.body_part,
      recommendations: output.report.recommendations,
      restFrom: output.report.rest_from,
      restTo: output.report.rest_to,
    },
    ocr,
    issues: [],
  };
  return refreshExtraction(extraction, text, { aliases });
}

/**
 * Recalcula lo derivado de un documento (métrica, conversión, avisos, comprobación contra el
 * texto) después de crearlo o de editarlo en la revisión. Lo que puso el usuario manda: si eligió
 * métrica se respeta; si no, se busca por el nombre.
 */
export function refreshExtraction(extraction, text, { aliases } = {}) {
  const items = extraction.items.map((item) => refreshItem(extraction.type, item, text, aliases));
  const issues = [];
  if (extraction.ocr) issues.push('ocr');
  if (!extraction.date) issues.push('date-missing');
  else if (!dateInText(extraction.date, text)) issues.push('date-unverified');
  const hourly = (extraction.hourly ?? []).map((row) => ({
    ...row,
    verified: hourlyInText(row, text),
  }));
  if (hourly.some((row) => !row.verified)) issues.push('hourly-unverified');

  return extractionSchema.parse({ ...extraction, items, hourly, issues });
}

function refreshItem(type, item, text, aliases) {
  const issues = [];
  const value = Number.isFinite(item.value) ? item.value : null;
  if (!valueInText(item.text, text) || (value != null && !sameNumber(item.text, value))) {
    issues.push('unverified');
  }

  // La métrica: la elegida, la de la medida (holter/esfuerzo) o la del nombre (analíticas)
  let metric = item.metric ?? null;
  if (!metric && type === 'lab') metric = findAnalyte(item.name, aliases)?.code ?? null;
  const known = metric ? clinicalMetric(metric) : null;

  let metricValue = null;
  let metricUnit = known?.unit ?? normalizeUnit(item.unit) ?? item.unit ?? null;
  if (value != null) {
    const converted = known ? toAnalyteUnit(known, value, item.unit) : { value, unit: metricUnit };
    if (converted) {
      metricValue = converted.value;
      metricUnit = converted.unit;
    } else {
      issues.push('unit');
    }
  }
  if (!metric && value != null) issues.push('unknown');
  if (value == null && item.text && !/^[<>≤≥]/.test(item.text.trim())) issues.push('qualitative');
  if (value == null && /^[<>≤≥]/.test(item.text?.trim() ?? '')) issues.push('censored');

  return {
    ...item,
    value,
    metric,
    metricValue,
    metricUnit,
    flag: item.flag ?? flagFromRange(value, item.rangeMin, item.rangeMax),
    issues,
  };
}

/** high/low si el valor se sale del rango (por si el modelo no lo marcó). */
function flagFromRange(value, min, max) {
  if (value == null) return null;
  if (max != null && value > max) return 'high';
  if (min != null && value < min) return 'low';
  return null;
}

/** Filas por hora: el inicio de cada una es el fin de la anterior (o el inicio de la prueba). */
function hourlyRows(rows, start) {
  const out = [];
  let previous = null;
  for (const row of [...rows].sort((a, b) => a.end.localeCompare(b.end))) {
    const end = minute(row.end);
    const begin = previous ?? (start && start < end ? start : addMinutes(end, -60));
    out.push({ start: begin, end, hrMin: row.hr_min, hrAvg: row.hr_avg, hrMax: row.hr_max });
    previous = end;
  }
  return out;
}

/** "YYYY-MM-DDTHH:mm" (sin segundos) o null. */
function minute(value) {
  return value ? value.slice(0, 16) : null;
}

function addMinutes(local, minutes) {
  const date = new Date(`${local}:00Z`);
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString().slice(0, 16);
}

// --- Comprobaciones contra el texto ----------------------------------------------------------

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** El valor tal como lo copió el modelo está en el texto (con coma o punto decimal). */
export function valueInText(valueText, text) {
  const v = String(valueText ?? '').trim();
  if (!v) return false;
  if (/\d/.test(v)) {
    const pattern = escape(v).replace(/\\\.|,/g, '[.,]');
    return new RegExp(`(?<![\\d.,])${pattern}(?![\\d])`).test(text);
  }
  return text.toLowerCase().includes(v.toLowerCase());
}

/** El número del modelo es el mismo que el texto que dice haber leído. */
function sameNumber(valueText, value) {
  const match = /-?\d+(?:[.,]\d+)?/.exec(String(valueText ?? ''));
  if (!match) return false;
  return Math.abs(Number(match[0].replace(',', '.')) - value) < 1e-9;
}

/** La fecha (YYYY-MM-DD) escrita en el texto de alguna forma habitual. */
export function dateInText(date, text) {
  const [y, m, d] = date.split('-');
  const dd = [d, String(Number(d))];
  const mm = [m, String(Number(m))];
  const years = [y, y.slice(2)];
  for (const day of dd) {
    for (const month of mm) {
      for (const year of years) {
        if (new RegExp(`(?<!\\d)${day}[/.-]${month}[/.-]${year}(?!\\d)`).test(text)) return true;
      }
    }
  }
  if (text.includes(date)) return true;
  const months = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ];
  const long = new RegExp(
    `(?<!\\d)0?${Number(d)}\\s+de\\s+${months[Number(m) - 1]}\\s+de\\s+${y}`,
    'i',
  );
  return long.test(text);
}

/** Una fila por hora del holter está en el texto: la hora y los tres números en orden. */
function hourlyInText(row, text) {
  const time = row.end.slice(11, 16);
  const nums = [row.hrMin, row.hrAvg, row.hrMax].map((n) => (n == null ? '\\S*' : String(n)));
  return new RegExp(
    `${escape(time)}(?:\\s+D\\d+)?\\s+${nums[0]}\\s+${nums[1]}\\s+${nums[2]}(?!\\d)`,
  ).test(text);
}
