/**
 * Lo común para llevar la cuenta del gasto en LLM (tabla llm_usage): precios, tokens, coste y
 * las filas. Lo usan la API (coach, macros, resumen de la página de IA) y el worker (los informes
 * clínicos).
 */

/**
 * "modelo:entrada/caché/salida" en USD por millón de tokens, separados por coma →
 * Map(modelo → { input, cached, output }).
 */
export function parsePrices(value) {
  const prices = new Map();
  for (const entry of value
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)) {
    const match = /^([^:]+):([\d.]+)\/([\d.]+)\/([\d.]+)$/.exec(entry);
    if (!match)
      throw new Error(`Precio de LLM mal escrito: "${entry}" (modelo:entrada/caché/salida)`);
    const [, model, input, cached, output] = match;
    prices.set(model.trim(), {
      input: Number(input),
      cached: Number(cached),
      output: Number(output),
    });
  }
  return prices;
}

/** El `usage` de cada proveedor → tokens de entrada (con los de caché dentro) y de salida. */
export function normalizeUsage(usage) {
  const input = usage?.prompt_tokens ?? 0;
  const cached = usage?.prompt_cache_hit_tokens ?? usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    inputTokens: input,
    cachedTokens: Math.min(cached, input),
    outputTokens: usage?.completion_tokens ?? 0,
  };
}

/** Coste en USD; 0 si el modelo no tiene precio configurado. */
export function costOf(prices, model, { inputTokens, cachedTokens, outputTokens }) {
  const price = prices.get(model);
  if (!price) return 0;
  return (
    ((inputTokens - cachedTokens) * price.input +
      cachedTokens * price.cached +
      outputTokens * price.output) /
    1e6
  );
}

/**
 * Apunta cada llamada al LLM con su coste. Nunca falla: un fallo aquí no puede tumbar una
 * respuesta.
 * @param {object} deps
 * @param {{ insert: (row: object) => Promise<void> }} deps.rows
 * @param {Map<string, { input: number, cached: number, output: number }>} deps.prices
 * @param {import('pino').Logger} [deps.logger]
 * @param {() => Date} [deps.now]
 */
export function createUsageRecorder({ rows, prices, logger, now = () => new Date() }) {
  /**
   * @param {{ feature: string, model: string, usage: object | null, durationMs?: number,
   *   error?: string, userId?: string, conversationId?: string, own?: boolean }} entry
   *   `own`: con la clave del usuario (no cuenta para su límite).
   */
  return async function record({
    feature,
    model,
    usage,
    durationMs,
    error,
    userId,
    conversationId,
    own = false,
  }) {
    const tokens = normalizeUsage(usage);
    try {
      await rows.insert({
        at: now(),
        feature,
        model,
        ...tokens,
        costUsd: costOf(prices, model, tokens),
        durationMs: durationMs ?? null,
        error: error ?? null,
        userId: userId ?? null,
        conversationId: conversationId ?? null,
        ownKey: own,
      });
    } catch (err) {
      logger?.error({ err, feature }, 'No se ha podido apuntar el consumo del LLM');
    }
  };
}

/** Filas en la BD (tabla llm_usage). */
export function createDbLlmUsageRows({ db }) {
  return {
    async insert(row) {
      await db`
        insert into llm_usage (at, user_id, feature, model, input_tokens, cached_tokens,
          output_tokens, cost_usd, duration_ms, error, conversation_id, own_key)
        values (${row.at}, ${row.userId}, ${row.feature}, ${row.model}, ${row.inputTokens},
          ${row.cachedTokens}, ${row.outputTokens}, ${row.costUsd}, ${row.durationMs},
          ${row.error}, ${row.conversationId}, ${row.ownKey ?? false})
      `;
    },

    async since(from) {
      const rows = await db`select * from llm_usage where at >= ${from} order by at`;
      return rows.map((r) => ({
        at: r.at,
        feature: r.feature,
        model: r.model,
        inputTokens: r.input_tokens,
        cachedTokens: r.cached_tokens,
        outputTokens: r.output_tokens,
        costUsd: Number(r.cost_usd),
        durationMs: r.duration_ms,
        error: r.error,
        userId: r.user_id,
        conversationId: r.conversation_id,
        ownKey: r.own_key,
      }));
    },
  };
}

/** Lo mismo en memoria (tests y arranque sin BD). */
export function createMemoryLlmUsageRows() {
  const items = [];
  return {
    async insert(row) {
      items.push({ ...row });
    },
    async since(from) {
      return items.filter((r) => r.at >= from).map((r) => ({ ...r }));
    },
  };
}

export {
  AI_PROVIDERS,
  AiLimitError,
  createAiAccess,
  createDbAiStore,
  createMemoryAiStore,
  extraBodyFor,
  keyHint,
  startOfDay,
  testProvider,
} from './access.js';
