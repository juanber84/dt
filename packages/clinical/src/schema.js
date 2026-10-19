import { z } from 'zod';

/**
 * Tipos de documento, en tres categorías: analíticas (valores con rango), pruebas (holter,
 * esfuerzo, ECG, imagen: unas medidas y la conclusión) e informes (lesión, consulta: texto).
 */
export const DOCUMENT_TYPES = Object.freeze([
  'lab',
  'holter',
  'stress_test',
  'ecg',
  'imaging',
  'other_test',
  'report',
]);
export const DOCUMENT_CATEGORIES = Object.freeze({
  analysis: ['lab'],
  test: ['holter', 'stress_test', 'ecg', 'imaging', 'other_test'],
  report: ['report'],
});
/** Categoría de un tipo ('analysis', 'test', 'report'). */
export const categoryOf = (type) =>
  Object.keys(DOCUMENT_CATEGORIES).find((c) => DOCUMENT_CATEGORIES[c].includes(type)) ?? 'report';

/** Qué es un informe (lesión, consulta...). */
export const REPORT_KINDS = Object.freeze([
  'injury',
  'consultation',
  'discharge',
  'physio',
  'other',
]);

const num = z.coerce.number().finite().nullable().catch(null);
const text = z.string().trim().nullable().catch(null);
const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .catch(null);
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
  .nullable()
  .catch(null);

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Lo que devuelve el modelo (snake_case, fechas locales). Tolerante: lo raro se queda en null. */
export const modelOutputSchema = z.object({
  type: z.enum(DOCUMENT_TYPES).catch('report'),
  title: z.string().trim().catch(''),
  center: text,
  date: localDate,
  start: localDateTime,
  end: localDateTime,
  summary: z.string().trim().catch(''),
  items: z
    .array(
      z.object({
        section: z.string().trim().catch(''),
        name: z.string().trim().min(1),
        value_text: z.coerce.string().trim().catch(''),
        value: num,
        unit: text,
        range_text: text,
        range_min: num,
        range_max: num,
        flag: z.enum(['high', 'low', 'abnormal']).nullable().catch(null),
        comment: z.string().trim().catch(''),
      }),
    )
    .catch([]),
  measures: z
    .array(
      z.object({
        key: z.string().trim().min(1),
        name: z.string().trim().catch(''),
        value_text: z.coerce.string().trim().catch(''),
        value: num,
        unit: text,
      }),
    )
    .catch([]),
  report: z
    .object({
      kind: z.enum(REPORT_KINDS).catch('other'),
      specialty: text,
      diagnosis: text,
      body_part: text,
      recommendations: z.array(z.string().trim().min(1)).catch([]),
      rest_from: localDate,
      rest_to: localDate,
    })
    .nullable()
    .catch(null),
  hourly: z
    .array(
      z.object({
        end: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/),
        hr_min: num,
        hr_avg: num,
        hr_max: num,
      }),
    )
    .catch([]),
});

const item = z.object({
  id: z.string().min(1),
  section: z.string().default(''),
  name: z.string().trim().min(1),
  /** El valor tal como sale en el informe ("1.41", "<0,5", "Negativo"). */
  text: z.string().default(''),
  value: z.number().finite().nullable(),
  unit: z.string().nullable().default(null),
  rangeText: z.string().nullable().default(null),
  rangeMin: z.number().finite().nullable().default(null),
  rangeMax: z.number().finite().nullable().default(null),
  flag: z.enum(['high', 'low', 'abnormal']).nullable().default(null),
  comment: z.string().default(''),
  /** Métrica del timeline (null: si es un número, al confirmar se crea una propia, lab.custom.*). */
  metric: z.string().nullable().default(null),
  /** El valor ya en la unidad de la métrica (null si no se puede convertir). */
  metricValue: z.number().finite().nullable().default(null),
  metricUnit: z.string().nullable().default(null),
  /** No guardarlo como dato del timeline (se queda solo en el documento). */
  skip: z.boolean().default(false),
  /** Clave de las medidas de holter/esfuerzo (hr_avg, vo2max...). */
  key: z.string().nullable().default(null),
  /** Avisos para la revisión: 'unverified' (no está en el texto), 'unit', 'unknown'... */
  issues: z.array(z.string()).default([]),
});

/**
 * Un documento ya extraído y revisable (lo que se guarda, se edita en la revisión y, al
 * confirmar, va al timeline). Fechas locales del usuario (YYYY-MM-DD, YYYY-MM-DDTHH:mm).
 */
export const extractionSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  title: z.string().trim().min(1),
  center: z.string().nullable().default(null),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    .nullable()
    .default(null),
  end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    .nullable()
    .default(null),
  summary: z.string().default(''),
  items: z.array(item).default([]),
  hourly: z
    .array(
      z.object({
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
        end: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
        hrMin: z.number().finite().nullable(),
        hrAvg: z.number().finite().nullable(),
        hrMax: z.number().finite().nullable(),
        verified: z.boolean().default(true),
      }),
    )
    .default([]),
  /** Lo de un informe (lesión, consulta...): null en analíticas y pruebas. */
  report: z
    .object({
      kind: z.enum(REPORT_KINDS).default('other'),
      specialty: z.string().nullable().default(null),
      diagnosis: z.string().nullable().default(null),
      bodyPart: z.string().nullable().default(null),
      recommendations: z.array(z.string()).default([]),
      /** Reposo o baja que indica (YYYY-MM-DD). */
      restFrom: isoDay.nullable().default(null),
      restTo: isoDay.nullable().default(null),
    })
    .nullable()
    .default(null),
  /** El texto salió del OCR (PDF escaneado): los números pueden venir mal leídos. */
  ocr: z.boolean().default(false),
  /** Avisos del documento entero ('date': no se ha encontrado la fecha en el texto...). */
  issues: z.array(z.string()).default([]),
});
