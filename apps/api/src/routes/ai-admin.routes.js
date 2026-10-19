import { Router } from 'express';

/** Días de margen por debajo de los cuales el saldo se marca como bajo. */
const LOW_RUNWAY_DAYS = 7;

/**
 * /api/v1/admin/ai (solo admin): qué LLM usa cada función, el saldo del proveedor y lo gastado.
 *
 * @param {object} deps
 * @param {Array<{ feature: string, model: string, baseUrl: string, configured: boolean }>} deps.models
 * @param {ReturnType<typeof import('../services/llm-usage.js').createLlmUsage>} deps.usage
 * @param {ReturnType<typeof import('../services/llm-balance.js').createDeepseekBalance>} [deps.balance]
 * @param {number} deps.warnBelowUsd
 */
export function createAiAdminRouter({ models, usage, balance, warnBelowUsd }) {
  const router = Router();

  router.get('/', async (req, res) => {
    const [summary, account] = await Promise.all([
      usage.summary(),
      balance
        ? balance.read().catch((err) => {
            req.log.warn({ err }, 'No se ha podido leer el saldo del LLM');
            return { error: err.message };
          })
        : null,
    ]);

    // Al ritmo de los últimos 7 días, para cuánto da (el gasto se apunta en USD)
    const usd = account?.balances?.find((b) => b.currency === 'USD');
    const perDay = summary.week.costUsd / 7;
    const runwayDays = usd && perDay > 0 ? usd.total / perDay : null;
    const low =
      account && !account.error
        ? !account.available ||
          (usd && usd.total < warnBelowUsd) ||
          (runwayDays !== null && runwayDays < LOW_RUNWAY_DAYS)
        : false;

    res.json({
      models: models.map(({ feature, model, baseUrl, configured }) => ({
        feature,
        model,
        host: new URL(baseUrl).host,
        configured,
      })),
      balance: account && { ...account, runwayDays, low: Boolean(low), warnBelowUsd },
      usage: summary,
    });
  });

  return router;
}
