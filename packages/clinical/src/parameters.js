import { ANALYTES, HOLTER_MEASURES, STRESS_TEST_MEASURES, normalizeName } from './analytes.js';
import { MEASURE_SECTIONS, TITLES, clinicalMetric, customMetricCode } from './review.js';

const SECTION_ORDER = [
  ...new Set(ANALYTES.map((a) => a.section)),
  ...Object.values(MEASURE_SECTIONS),
];
const CATALOG_ORDER = new Map(
  [...ANALYTES, ...HOLTER_MEASURES, ...STRESS_TEST_MEASURES].map((m, i) => [m.code, i]),
);

/**
 * Evolución de cada parámetro a lo largo de los documentos confirmados: un punto por documento,
 * en la unidad de su métrica (con el rango de ese laboratorio convertido igual). Los resultados de
 * texto ("Negativo") también salen, sin valor.
 * @param {{ id: string, extraction: object }[]} documents
 * @returns {{ code: string, name: string, section: string, unit: string | null,
 *   latest: object, points: object[] }[]}
 */
export function buildParameters(documents) {
  const byCode = new Map();
  for (const doc of documents) {
    const extraction = doc.extraction;
    if (!extraction) continue;
    for (const item of extraction.items) {
      if (item.skip) continue;
      const code =
        item.metric ??
        (item.metricValue != null
          ? customMetricCode(extraction.type, item)
          : `text.${normalizeName(item.name)}`);
      const known = clinicalMetric(code);
      const entry = byCode.get(code) ?? {
        code,
        name: known?.label ?? item.name,
        section:
          known?.section ??
          MEASURE_SECTIONS[extraction.type] ??
          (item.section || TITLES[extraction.type]),
        unit: item.metricUnit ?? item.unit ?? null,
        points: [],
      };
      // Mismo factor para el rango que para el valor (si se convirtió de mmol/L a mg/dL...)
      const factor =
        item.value && item.metricValue != null && item.value !== item.metricValue
          ? item.metricValue / item.value
          : 1;
      const scale = (n) => (n == null ? null : Math.round(n * factor * 1000) / 1000);
      entry.points.push({
        documentId: doc.id,
        date: extraction.date,
        text: item.text,
        value: item.metricValue ?? null,
        unit: item.metricUnit ?? item.unit ?? null,
        rangeText: item.rangeText,
        rangeMin: scale(item.rangeMin),
        rangeMax: scale(item.rangeMax),
        flag: item.flag,
      });
      byCode.set(code, entry);
    }
  }

  const sectionIndex = (s) => {
    const i = SECTION_ORDER.indexOf(s);
    return i < 0 ? SECTION_ORDER.length : i;
  };
  return [...byCode.values()]
    .map((entry) => {
      const points = entry.points.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
      return { ...entry, points, latest: points.at(-1) };
    })
    .sort(
      (a, b) =>
        sectionIndex(a.section) - sectionIndex(b.section) ||
        a.section.localeCompare(b.section) ||
        (CATALOG_ORDER.get(a.code) ?? Infinity) - (CATALOG_ORDER.get(b.code) ?? Infinity) ||
        a.name.localeCompare(b.name),
    );
}

/** Las métricas que se pueden elegir al revisar un documento (para el desplegable). */
export function metricOptions() {
  return [
    ...ANALYTES.map(({ code, label, unit, section }) => ({ code, label, unit, section })),
    ...HOLTER_MEASURES.map(({ code, label, unit }) => ({ code, label, unit, section: 'Holter' })),
    ...STRESS_TEST_MEASURES.map(({ code, label, unit }) => ({
      code,
      label,
      unit,
      section: 'Prueba de esfuerzo',
    })),
  ];
}
