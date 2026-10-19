/**
 * Clínica: informes médicos en PDF (/api/v1/clinical). Las llamadas y las funciones puras que
 * usan las vistas (textos, estados, edición de valores y rangos) para poder probarlas sin API.
 */
import { apiFetch } from '../api.js';

const BASE = '/api/v1/clinical';

export const listDocuments = () => apiFetch(`${BASE}/documents`).then((r) => r.items);
export const getDocument = (id) => apiFetch(`${BASE}/documents/${id}`);
export const saveDocument = (id, extraction) =>
  apiFetch(`${BASE}/documents/${id}`, { method: 'PUT', body: JSON.stringify({ extraction }) });
export const confirmDocument = (id, extraction) =>
  apiFetch(`${BASE}/documents/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify(extraction ? { extraction } : {}),
  });
export const retryDocument = (id) => apiFetch(`${BASE}/documents/${id}/retry`, { method: 'POST' });
export const deleteDocument = (id) => apiFetch(`${BASE}/documents/${id}`, { method: 'DELETE' });
export const listParameters = () => apiFetch(`${BASE}/parameters`).then((r) => r.items);

let metrics;
/** Las métricas que se pueden asignar (no cambian: se piden una vez). */
export function listMetrics() {
  metrics ??= apiFetch(`${BASE}/metrics`)
    .then((r) => r.items)
    .catch((err) => {
      metrics = undefined;
      throw err;
    });
  return metrics;
}

/**
 * Sube un PDF tal cual (sin base64). `date`: el día desde el que se sube (si el informe no trae
 * fecha, se queda ahí). Devuelve { document, created }.
 */
export function uploadDocument(file, date) {
  const params = new URLSearchParams({ name: file.name, ...(date && { date }) });
  return apiFetch(`${BASE}/documents?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: file,
  });
}

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** Lo que se le puede decir al usuario antes de subir (null si vale). */
export function uploadProblem(file) {
  if (!file) return 'Elige un PDF';
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) return 'Solo se pueden subir PDFs';
  if (file.size > MAX_UPLOAD_BYTES) return 'El PDF pesa más de 15 MB';
  return null;
}

// --- Textos y estados -----------------------------------------------------------------------

export const TYPE_LABEL = {
  lab: 'Analítica',
  holter: 'Holter',
  stress_test: 'Prueba de esfuerzo',
  ecg: 'Electrocardiograma',
  imaging: 'Prueba de imagen',
  other_test: 'Otra prueba',
  report: 'Informe médico',
};
export const TYPE_ICON = {
  lab: 'FlaskConical',
  holter: 'HeartPulse',
  stress_test: 'Gauge',
  ecg: 'Activity',
  imaging: 'ScanLine',
  other_test: 'Stethoscope',
  report: 'ClipboardList',
};

/** Las tres categorías: analíticas (valores con rango), pruebas (medidas) e informes (texto). */
export const CATEGORIES = [
  { value: 'analysis', label: 'Analíticas', types: ['lab'] },
  {
    value: 'test',
    label: 'Pruebas',
    types: ['holter', 'stress_test', 'ecg', 'imaging', 'other_test'],
  },
  { value: 'report', label: 'Informes', types: ['report'] },
];
export const categoryOf = (type) =>
  CATEGORIES.find((c) => c.types.includes(type))?.value ?? 'report';

/** El desplegable de tipo, agrupado por categoría. */
export const TYPE_GROUPS = CATEGORIES.map((c) => ({
  label: c.label,
  options: c.types.map((value) => ({ value, label: TYPE_LABEL[value] })),
}));

export const REPORT_KIND_LABEL = {
  injury: 'Lesión',
  consultation: 'Consulta',
  discharge: 'Alta',
  physio: 'Fisioterapia',
  other: 'Otro',
};

/** Estado del documento → píldora (el color nunca va solo: lleva texto). */
export function statusPill(status) {
  return (
    {
      processing: { tone: 'neutral', label: 'Leyendo…' },
      review: { tone: 'warning', label: 'Por revisar' },
      confirmed: { tone: 'good', label: 'En el timeline' },
      error: { tone: 'critical', label: 'Error' },
    }[status] ?? { tone: 'neutral', label: status }
  );
}

/** Avisos de cada valor (los que salen de la comprobación contra el texto). */
export const ISSUE_LABEL = {
  unverified: 'No aparece así en el informe: compruébalo',
  unit: 'La unidad no es la de la métrica: elige otra métrica o corrige la unidad',
  unknown: 'Parámetro nuevo: se guardará con su propio nombre',
  qualitative: 'Resultado de texto: se guarda en el documento, sin gráfica',
  censored: 'Valor fuera del límite del laboratorio: se guarda como texto',
};
/** Los que piden mirar el valor (el resto son informativos). */
export const BLOCKING_ISSUES = ['unverified', 'unit'];

export const DOCUMENT_ISSUE_LABEL = {
  'date-missing': 'No se ha encontrado la fecha de la prueba: ponla antes de confirmar',
  'date-unverified': 'La fecha no aparece así en el informe: compruébala',
  'date-from-upload':
    'El informe no trae fecha: se ha puesto el día desde el que lo subiste. Compruébala',
  'hourly-unverified': 'Alguna fila de la tabla por horas no cuadra con el informe',
  ocr: 'Era un PDF escaneado y se ha leído con OCR: repasa bien los números',
};

/**
 * Avisos del documento para enseñar: si la fecha no está en el informe y es la del día desde el
 * que se subió, se dice así (no es que la IA se la haya inventado).
 */
export function documentIssues(extraction, requestedDate) {
  return (extraction?.issues ?? []).map((i) =>
    i === 'date-unverified' && requestedDate && extraction.date === requestedDate
      ? 'date-from-upload'
      : i,
  );
}

export { documentDay } from './timeline.js';

/** El informe se leyó con otra fecha que la del día desde el que se subió. */
export const movedFrom = (doc) =>
  doc.date && doc.requestedDate && doc.date !== doc.requestedDate ? doc.requestedDate : null;

export const needsLook = (item) => item.issues?.some((i) => BLOCKING_ISSUES.includes(i));

/** "50 valores · 1 fuera de rango · 2 por comprobar" */
export function countsText(counts) {
  if (!counts?.items) return '';
  const parts = [`${counts.items} ${counts.items === 1 ? 'valor' : 'valores'}`];
  if (counts.flagged) parts.push(`${counts.flagged} fuera de rango`);
  if (counts.issues) parts.push(`${counts.issues} con aviso`);
  return parts.join(' · ');
}

export const FLAG_LABEL = { high: 'Alto', low: 'Bajo', abnormal: 'Anómalo' };

// --- Edición --------------------------------------------------------------------------------

/** El número de un resultado escrito a mano ("1,41" → 1.41); null si no es un número simple. */
export function parseValue(text) {
  const t = String(text ?? '').trim();
  if (!/^-?\d+(?:[.,]\d+)?$/.test(t)) return null;
  return Number(t.replace(',', '.'));
}

const num = (s) => Number(String(s).replace(',', '.'));

/**
 * Rango escrito como en los informes → { min, max }: "(0.6 - 1.3)", "Inf. 200", "< 200",
 * "Sup. 40", "> 40". Lo que no se entienda, sin límites.
 */
export function parseRange(text) {
  const t = String(text ?? '').trim();
  const n = '(-?\\d+(?:[.,]\\d+)?)';
  let m = new RegExp(`^\\(?\\s*${n}\\s*[-–]\\s*${n}\\s*\\)?$`).exec(t);
  if (m) return { min: num(m[1]), max: num(m[2]) };
  m = new RegExp(`^\\(?\\s*(?:inf\\.?|<|≤|hasta)\\s*${n}\\s*\\)?$`, 'i').exec(t);
  if (m) return { min: null, max: num(m[1]) };
  m = new RegExp(`^\\(?\\s*(?:sup\\.?|>|≥|desde)\\s*${n}\\s*\\)?$`, 'i').exec(t);
  if (m) return { min: num(m[1]), max: null };
  return { min: null, max: null };
}

/** Un valor editado: lo escrito manda y el número y el rango salen de ahí (la API recalcula). */
export function editItem(item, changes) {
  const next = { ...item, ...changes };
  if ('text' in changes) next.value = parseValue(changes.text);
  if ('rangeText' in changes) {
    const { min, max } = parseRange(changes.rangeText);
    next.rangeMin = min;
    next.rangeMax = max;
  }
  // Un cambio de valor, unidad o métrica puede dejar de estar fuera de rango: lo recalcula la API
  if ('text' in changes || 'rangeText' in changes) next.flag = null;
  return next;
}

/** Valor de la métrica en el desplegable: '' (automática/nueva), '__skip' (no guardar) o el código. */
export const SKIP = '__skip';
export const metricChoice = (item) => (item.skip ? SKIP : (item.metric ?? ''));
export function chooseMetric(item, choice) {
  if (choice === SKIP) return { ...item, skip: true };
  return { ...item, skip: false, metric: choice || null };
}

/** Las métricas agrupadas por sección para el desplegable. */
export function metricGroups(list) {
  const groups = new Map();
  for (const m of list) {
    if (!groups.has(m.section)) groups.set(m.section, []);
    groups.get(m.section).push(m);
  }
  return [...groups].map(([section, options]) => ({ section, options }));
}

/** Los valores agrupados por sección, en el orden del informe. */
export function bySection(items) {
  const groups = [];
  for (const item of items) {
    const name = item.section || 'Sin sección';
    let group = groups.at(-1);
    if (group?.section !== name) {
      group = groups.find((g) => g.section === name);
      if (!group) groups.push((group = { section: name, items: [] }));
    }
    group.items.push(item);
  }
  return groups;
}

/** "YYYY-MM-DDTHH:mm" ↔ lo que usa <input type="datetime-local"> (es lo mismo). */
export const toDateTimeInput = (value) => value ?? '';
export const fromDateTimeInput = (value) => (value ? value.slice(0, 16) : null);

/** Fecha corta en español: "7 oct 2026". */
export function fmtDocDate(date) {
  if (!date) return 'Sin fecha';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Un número tal como lo escribiría un informe en español (coma decimal, sin ceros de más). */
export function fmtNumber(value) {
  if (value == null) return '—';
  return value.toLocaleString('es-ES', { maximumFractionDigits: 3 });
}

/** "(0,6 – 1,3)", "< 200", "> 40" a partir de los límites (o el texto del informe). */
export function rangeText(point) {
  if (point.rangeMin != null && point.rangeMax != null)
    return `${fmtNumber(point.rangeMin)} – ${fmtNumber(point.rangeMax)}`;
  if (point.rangeMax != null) return `< ${fmtNumber(point.rangeMax)}`;
  if (point.rangeMin != null) return `> ${fmtNumber(point.rangeMin)}`;
  return point.rangeText ?? '';
}

/** Unidades UCUM → como se leen ("10*3/uL" → "10³/µL"). */
export function fmtUnit(unit) {
  if (!unit || unit === '1') return '';
  return (
    {
      '10*3/uL': '10³/µL',
      '10*6/uL': '10⁶/µL',
      'mL/min/{1.73_m2}': 'mL/min/1,73 m²',
      '/min': 'lpm',
      'm[IU]/L': 'mUI/L',
      'mm[Hg]': 'mmHg',
      'ug/dL': 'µg/dL',
      'ug/L': 'µg/L',
      'umol/L': 'µmol/L',
    }[unit] ?? unit
  );
}

// --- Vista de Clínica: resumen, evolución e historial -----------------------------------------

const newest = (list) =>
  [...list].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0] ?? null;

/**
 * Las fichas de arriba: la última analítica, lo que está fuera de rango ahora (el último valor de
 * cada parámetro), y cuántas pruebas e informes hay. Solo cuenta lo confirmado.
 */
export function clinicalOverview(documents, parameters) {
  const confirmed = documents.filter((d) => d.status === 'confirmed');
  const of = (category) => confirmed.filter((d) => categoryOf(d.type) === category);
  const flaggedNow = parameters.filter((p) => p.latest?.flag);
  return {
    lastLab: newest(of('analysis')),
    labs: of('analysis').length,
    flaggedNow,
    tests: of('test').length,
    lastTest: newest(of('test')),
    reports: of('report').length,
    lastReport: newest(of('report')),
    pending: documents.filter((d) => d.status !== 'confirmed').length,
  };
}

/**
 * Todos los parámetros de la categoría pedida ('all', 'analysis', 'test') agrupados por sección
 * (en el orden que da la API), con su medida anterior para la comparación.
 */
export function parameterGroups(parameters, documents, category = 'all') {
  const typeOf = new Map(documents.map((d) => [d.id, d.type]));
  const groups = new Map();
  for (const p of parameters) {
    const inCategory =
      category === 'all' || p.points.some((x) => categoryOf(typeOf.get(x.documentId)) === category);
    if (!inCategory) continue;
    const numeric = p.points.filter((x) => x.value != null);
    const previous = numeric.length >= 2 ? numeric.at(-2) : null;
    if (!groups.has(p.section)) groups.set(p.section, []);
    groups.get(p.section).push({
      ...p,
      trend: numeric.length >= 2 ? numeric.map((x) => x.value) : null,
      previous,
      delta: previous && p.latest.value != null ? p.latest.value - previous.value : null,
    });
  }
  return [...groups].map(([section, items]) => ({ section, items }));
}

// Lo que se enseña de cada prueba en el historial (summary.measures)
const KEY_MEASURES = [
  ['hr_avg', 'FC media', 'ppm'],
  ['vo2max', 'VO2max', 'mL/kg/min'],
  ['sdnn', 'SDNN', 'ms'],
  ['hr_max', 'FC máx.', 'ppm'],
  ['qtc_ms', 'QTc', 'ms'],
];

/** Lo que va en cada fila del historial, según la categoría. */
export function historyCells(doc) {
  const category = categoryOf(doc.type);
  if (doc.status !== 'confirmed') return [];
  if (category === 'analysis') {
    return [
      { label: 'Valores', value: String(doc.counts?.items ?? 0) },
      {
        label: 'Fuera de rango',
        value: String(doc.counts?.flagged ?? 0),
        alert: doc.counts?.flagged > 0,
      },
    ];
  }
  if (category === 'test') {
    return KEY_MEASURES.filter(([key]) => doc.measures?.[key] != null)
      .slice(0, 2)
      .map(([key, label, unit]) => ({ label, value: `${fmtNumber(doc.measures[key])} ${unit}` }));
  }
  return doc.restTo ? [{ label: 'Reposo hasta', value: fmtDocDate(doc.restTo) }] : [];
}

/**
 * Dónde cae un valor respecto a su rango, en % del ancho de la barra: { band: [desde, hasta],
 * marker }. El eje deja medio rango de margen a cada lado (y se estira si el valor se sale más).
 * "Inf. 200" (solo máximo) va de 0 al máximo; "Sup. 40" (solo mínimo) del mínimo al final.
 * null si no hay valor o rango.
 */
export function gaugeGeometry(value, min, max) {
  if (value == null || (min == null && max == null)) return null;
  let lo;
  let hi;
  if (min != null && max != null) {
    const pad = (max - min) / 2 || Math.abs(max) / 2 || 1;
    lo = min - pad;
    hi = max + pad;
  } else if (max != null) {
    lo = Math.min(0, value);
    hi = max * 1.5 || 1;
  } else {
    lo = Math.min(0, value);
    hi = min * 2 || 1;
  }
  lo = Math.min(lo, value);
  hi = Math.max(hi, value);
  const pct = (v) => Math.round(((v - lo) / (hi - lo)) * 1000) / 10;
  return {
    band: [pct(min ?? lo), pct(max ?? hi)],
    marker: pct(value),
  };
}
