import { z } from 'zod';

const DAY_MS = 24 * 3600 * 1000;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha YYYY-MM-DD');

/** Error que se le cuenta al modelo (como el ToolError de @digitaltwin/mcp: runTool mira el nombre). */
class ToolError extends Error {
  name = 'ToolError';
}

/**
 * show_chart: el coach enseña una gráfica en el chat. Los datos los saca `getSeries` (el handler
 * de get_series de @digitaltwin/mcp, ya atado al usuario). La gráfica entera va a la app en
 * `display`; al modelo solo le vuelve un resumen por serie (mín, máx, media, último), que es lo
 * que necesita para comentarla sin gastar tokens en cada punto.
 *
 * @param {object} deps
 * @param {(args: { metrics: string[], from: string, to: string, bucket: 'day' | 'hour' }) => Promise<object>} deps.getSeries
 */
export function createChartTool({ getSeries }) {
  return {
    name: 'show_chart',
    title: 'Enseñar una gráfica',
    display: 'chart',
    description:
      'Enseña al usuario una gráfica en el chat con la evolución de 1 a 4 métricas (códigos de ' +
      'list_metrics), por día (hasta 400 días) o por hora (hasta 7 días). Úsala cuando algo se ' +
      'entienda mejor viéndolo: el peso del último mes, el sueño de la semana, la FC de un ' +
      'entreno. Las métricas de distinta unidad salen en gráficas separadas, una debajo de otra. ' +
      'Te devuelve un resumen de cada serie para que la comentes: no repitas los valores de cada ' +
      'día, el usuario ya los ve.',
    inputSchema: {
      title: z.string().trim().min(1).max(80).describe('Título corto, p. ej. "Peso, último mes"'),
      metrics: z.array(z.string().min(1).max(80)).min(1).max(4),
      from: date.describe('Primer día incluido, YYYY-MM-DD'),
      to: date.describe('Último día incluido, YYYY-MM-DD'),
      bucket: z.enum(['day', 'hour']).default('day'),
      kind: z
        .enum(['line', 'bar'])
        .optional()
        .describe(
          'line para niveles (peso, FC, VFC), bar para totales del día (pasos, kcal, proteína). ' +
            'Por defecto, bar si la métrica se suma y line si no',
        ),
      average: z
        .boolean()
        .default(false)
        .describe('Añade la media de 7 días (solo por día; útil con el peso, que oscila)'),
    },
    handler: async ({ title, metrics, from, to, bucket = 'day', kind, average = false }) => {
      const data = await getSeries({ metrics, from, to, bucket });
      const found = metrics.filter((code) => data.series[code]?.points.length);
      if (!found.length) throw new ToolError('No hay datos de esas métricas en ese rango');

      const keyOf = bucket === 'day' ? 'date' : 't';
      // Por día, todos los días del rango (los huecos se ven como huecos); por hora, las que haya
      const labels =
        bucket === 'day'
          ? daysBetween(from, to)
          : [...new Set(found.flatMap((c) => data.series[c].points.map((p) => p.t)))].sort();
      const series = found.map((code) => {
        const s = data.series[code];
        const byKey = new Map(s.points.map((p) => [p[keyOf], p.value]));
        return {
          code,
          label: s.label,
          unit: s.unit,
          aggregation: s.aggregation,
          values: labels.map((l) => byKey.get(l) ?? null),
        };
      });

      const chart = {
        title,
        bucket,
        kind: kind ?? (series.every((s) => s.aggregation === 'sum') ? 'bar' : 'line'),
        average: average && bucket === 'day',
        labels,
        series,
      };
      const missing = metrics.filter((code) => !found.includes(code));
      return {
        display: chart,
        result: {
          shown: true,
          series: series.map((s) => summarize(s, labels)),
          ...(missing.length && { noData: missing }),
        },
      };
    },
  };
}

function summarize({ code, label, unit, values }, labels) {
  const points = values
    .map((value, i) => ({ at: labels[i], value }))
    .filter((p) => p.value != null);
  const nums = points.map((p) => p.value);
  const round = (v) => Math.round(v * 100) / 100;
  return {
    code,
    label,
    unit,
    points: points.length,
    min: round(Math.min(...nums)),
    max: round(Math.max(...nums)),
    mean: round(nums.reduce((a, b) => a + b, 0) / nums.length),
    first: { at: points[0].at, value: points[0].value },
    last: { at: points.at(-1).at, value: points.at(-1).value },
  };
}

function daysBetween(from, to) {
  const out = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
