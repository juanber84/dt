import { localDate } from '@digitaltwin/mcp';
import { localMidnight } from '@digitaltwin/timeline';
import { createUsageRecorder } from '@digitaltwin/llm-usage';

export {
  parsePrices,
  normalizeUsage,
  costOf,
  createDbLlmUsageRows,
  createMemoryLlmUsageRows,
} from '@digitaltwin/llm-usage';

/** Días que enseña el resumen (gráfica de gasto por día). */
const SUMMARY_DAYS = 30;

/**
 * Cuenta del gasto en LLM: `record` apunta cada llamada (nunca falla: un fallo aquí no puede
 * tumbar una respuesta) y `summary` resume para la página de admin.
 *
 * @param {object} deps
 * @param {{ insert: (row: object) => Promise<void>, since: (from: Date) => Promise<object[]> }} deps.rows
 * @param {Map<string, { input: number, cached: number, output: number }>} deps.prices
 * @param {string} deps.timeZone
 * @param {import('pino').Logger} [deps.logger]
 * @param {() => Date} [deps.now]
 */
export function createLlmUsage({ rows, prices, timeZone, logger, now = () => new Date() }) {
  return {
    record: createUsageRecorder({ rows, prices, logger, now }),

    /** Hoy, 7 días, el mes en curso, gasto por día y función (30 días) y las últimas llamadas. */
    async summary() {
      const today = localDate(now(), timeZone);
      const first = addDays(today, -(SUMMARY_DAYS - 1));
      const monthStart = `${today.slice(0, 8)}01`;
      const from = localMidnight(first < monthStart ? first : monthStart, timeZone);
      const items = await rows.since(from);
      return summarize(items, { today, first, monthStart, timeZone, prices });
    },
  };
}

function summarize(items, { today, first, monthStart, timeZone, prices }) {
  const weekStart = addDays(today, -6);
  const empty = () => ({ costUsd: 0, calls: 0, errors: 0 });
  const totals = { today: empty(), week: empty(), month: empty() };
  const days = new Map();
  for (let d = first; d <= today; d = addDays(d, 1))
    days.set(d, { date: d, costUsd: 0, calls: 0, byFeature: {} });
  const features = new Map();

  for (const row of items) {
    const date = localDate(row.at, timeZone);
    const add = (bucket) => {
      bucket.costUsd += row.costUsd;
      bucket.calls += 1;
      if (row.error) bucket.errors += 1;
    };
    if (date === today) add(totals.today);
    if (date >= weekStart) add(totals.week);
    if (date >= monthStart) add(totals.month);

    const day = days.get(date);
    if (!day) continue;
    day.costUsd += row.costUsd;
    day.calls += 1;
    day.byFeature[row.feature] = (day.byFeature[row.feature] ?? 0) + row.costUsd;

    const feature = features.get(row.feature) ?? {
      feature: row.feature,
      ...empty(),
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
    };
    add(feature);
    feature.inputTokens += row.inputTokens;
    feature.cachedTokens += row.cachedTokens;
    feature.outputTokens += row.outputTokens;
    features.set(row.feature, feature);
  }

  return {
    today: totals.today,
    week: totals.week,
    month: totals.month,
    days: [...days.values()],
    features: [...features.values()].sort((a, b) => b.costUsd - a.costUsd),
    recent: items
      .toSorted((a, b) => b.at - a.at)
      .slice(0, 50)
      .map((row) => ({ ...row, at: row.at.toISOString() })),
    prices: Object.fromEntries(prices),
  };
}

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
