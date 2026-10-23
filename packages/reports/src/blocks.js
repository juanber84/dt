import { z } from 'zod';

/**
 * Un informe es una lista de bloques. Los de datos (cifras, tablas, gráficas) los rellena siempre
 * el servidor con lo que hay en la BD: la IA solo elige bloques y escribe el texto. Lo que se
 * guarda ya va resuelto (los números de ese momento), así que el informe no cambia al reabrirlo.
 *
 *   heading  { text }
 *   text     { text }                       párrafos separados por una línea en blanco
 *   stats    { title?, items: [{ label, value, unit?, digits?, target?, note? }] }
 *            value null = "sin datos"; target, el objetivo con el que comparar
 *   table    { title?, columns: [string], rows: [[string | number | null]] }
 *   chart    { title, bucket, kind, average, labels, series, target? }   la de show_chart del coach
 *   callout  { tone: 'info' | 'warning', text }
 */
const stat = z.object({
  label: z.string(),
  value: z.number().nullable(),
  unit: z.string().optional(),
  digits: z.number().int().min(0).max(2).optional(),
  target: z.number().nullable().optional(),
  note: z.string().optional(),
});

const series = z.object({
  code: z.string(),
  label: z.string(),
  unit: z.string(),
  aggregation: z.string().optional(),
  /** points: puntos sueltos sin línea (el peso de cada día, alrededor de su tendencia) */
  style: z.enum(['line', 'points']).optional(),
  values: z.array(z.number().nullable()),
});

export const blockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), text: z.string() }),
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('stats'), title: z.string().optional(), items: z.array(stat) }),
  z.object({
    type: z.literal('table'),
    title: z.string().optional(),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
  }),
  z.object({
    type: z.literal('chart'),
    title: z.string(),
    bucket: z.enum(['day', 'hour']),
    kind: z.enum(['line', 'bar']),
    average: z.boolean().default(false),
    labels: z.array(z.string()),
    series: z.array(series).min(1),
    /** Una línea horizontal de referencia (el objetivo de kcal...). */
    target: z.object({ value: z.number(), label: z.string().optional() }).optional(),
  }),
  z.object({ type: z.literal('callout'), tone: z.enum(['info', 'warning']), text: z.string() }),
]);

export const reportSchema = z.object({
  kind: z.string(),
  title: z.string(),
  /** Día (YYYY-MM-DD) o rango del que habla. */
  periodFrom: z.string(),
  periodTo: z.string(),
  blocks: z.array(blockSchema),
});

export { formatNumber, formatStat } from './format.js';
