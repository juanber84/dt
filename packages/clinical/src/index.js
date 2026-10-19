import { extractPdfText } from './pdf.js';
import { redactPersonalData } from './redact.js';
import { buildExtraction } from './review.js';

export { extractPdfText, isPdf } from './pdf.js';
export { redactPersonalData, MASK } from './redact.js';
export {
  ANALYTES,
  HOLTER_MEASURES,
  STRESS_TEST_MEASURES,
  CLINICAL_METRICS,
  getAnalyte,
  findAnalyte,
  normalizeName,
  normalizeUnit,
  toAnalyteUnit,
} from './analytes.js';
export {
  DOCUMENT_TYPES,
  DOCUMENT_CATEGORIES,
  REPORT_KINDS,
  categoryOf,
  modelOutputSchema,
  extractionSchema,
} from './schema.js';
export {
  buildExtraction,
  refreshExtraction,
  clinicalMetric,
  customMetricCode,
  valueInText,
  dateInText,
  TITLES,
  MEASURE_SECTIONS,
} from './review.js';
export { ClinicalExtractor, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL } from './extractor.js';
export { buildParameters, metricOptions } from './parameters.js';
export {
  createDbClinicalStore,
  createMemoryClinicalStore,
  DocumentStatus,
  sha256,
} from './store.js';
export { ClinicalError, ClinicalErrorCode } from './errors.js';

/**
 * Un PDF de principio a fin: texto, fuera los datos personales, extracción con el LLM y documento
 * revisable. Solo el texto limpio sale de la máquina.
 * @param {object} input
 * @param {Uint8Array} input.data  El PDF.
 * @param {Pick<import('./extractor.js').ClinicalExtractor, 'extract'>} input.extractor
 * @param {string[]} [input.names]  Nombres a quitar además (los del usuario).
 * @param {Map<string, string>} [input.aliases]  Nombres ya confirmados → métrica.
 * @param {string | null} [input.fallbackDate]  Día desde el que se subió (si no trae fecha).
 * @param {{ userId?: string }} [input.context]
 * @param {typeof extractPdfText} [input.pdfText]
 */
export async function processPdf({
  data,
  extractor,
  names = [],
  aliases,
  fallbackDate = null,
  context,
  pdfText = extractPdfText,
}) {
  const raw = await pdfText(data);
  const { text, count } = redactPersonalData(raw, { names });
  const output = await extractor.extract(text, context);
  return {
    text,
    redactions: count,
    extraction: buildExtraction(output, text, { aliases, fallbackDate }),
  };
}
