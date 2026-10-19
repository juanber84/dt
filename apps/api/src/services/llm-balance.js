const CACHE_MS = 60_000;

/**
 * Saldo de la cuenta de DeepSeek (GET /user/balance), cacheado un minuto. Otros proveedores no
 * tienen este endpoint: para ellos no se crea.
 *
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} options.baseUrl
 * @param {typeof fetch} [options.fetch]
 * @param {() => number} [options.now]
 * @returns {{ read: () => Promise<{ available: boolean, balances: Array<{ currency: string,
 *   total: number, granted: number, toppedUp: number }>, checkedAt: string }> }}
 */
export function createDeepseekBalance({
  apiKey,
  baseUrl,
  fetch = globalThis.fetch,
  now = Date.now,
}) {
  const url = `${baseUrl.replace(/\/+$/, '')}/user/balance`;
  let cached = null;

  return {
    async read() {
      if (cached && now() - cached.at < CACHE_MS) return cached.value;
      const response = await fetch(url, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          `DeepSeek /user/balance: ${response.status} ${payload?.error?.message ?? ''}`.trim(),
        );
      }
      const value = {
        available: Boolean(payload?.is_available),
        balances: (payload?.balance_infos ?? []).map((b) => ({
          currency: b.currency,
          total: Number(b.total_balance),
          granted: Number(b.granted_balance),
          toppedUp: Number(b.topped_up_balance),
        })),
        checkedAt: new Date(now()).toISOString(),
      };
      cached = { at: now(), value };
      return value;
    },
  };
}

/** Solo DeepSeek tiene endpoint de saldo. */
export const hasBalanceEndpoint = (baseUrl) =>
  /(^|\.)deepseek\.com/.test(new URL(baseUrl).hostname);
