/** La API de fuera (o nuestro propio límite) pide esperar: el trabajo se aplaza, no falla. */
export class RateLimitedError extends Error {
  constructor(provider, retryAfterSeconds) {
    super(`${provider}: límite de peticiones, se reintenta en ${retryAfterSeconds} s`);
    this.name = 'RateLimitedError';
    this.provider = provider;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Límite por proveedor compartido entre todos los workers (contador por ventana en la BD).
 * @param {object} deps
 * @param {{ hitRateLimit: Function }} deps.store
 * @param {Record<string, number>} deps.perMinute  peticiones por minuto de cada proveedor
 */
export function createRateLimiter({ store, perMinute }) {
  return {
    /** Lanza RateLimitedError si ya no quedan peticiones en esta ventana. */
    async take(provider) {
      const limit = perMinute[provider];
      if (!limit) return;
      const { allowed, retryAfterSeconds } = await store.hitRateLimit(`api:${provider}`, limit, 60);
      if (!allowed) throw new RateLimitedError(provider, retryAfterSeconds);
    },
  };
}
