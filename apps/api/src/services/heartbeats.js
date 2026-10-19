/**
 * Últimas señales de vida de los servicios que hablan con la API (el bot, de momento).
 * En memoria: si la API se reinicia, el servicio vuelve a aparecer con su siguiente latido.
 * @param {object} [options]
 * @param {() => number} [options.now]
 * @param {number} [options.missedBeats] Latidos perdidos seguidos para darlo por caído.
 */
export function createHeartbeats({ now = Date.now, missedBeats = 3 } = {}) {
  const last = new Map();

  return {
    /** @param {string} service @param {{ intervalMs: number, [key: string]: unknown }} info */
    beat(service, info) {
      last.set(service, { ...info, lastSeenAt: now() });
    },

    snapshot() {
      const at = now();
      return Object.fromEntries(
        [...last].map(([service, { lastSeenAt, ...info }]) => [
          service,
          {
            ...info,
            status: at - lastSeenAt > info.intervalMs * missedBeats ? 'stale' : 'ok',
            lastSeenAt: new Date(lastSeenAt).toISOString(),
          },
        ]),
      );
    },
  };
}
