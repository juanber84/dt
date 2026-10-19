/**
 * Avisa a la API cada `intervalMs` de que el bot sigue vivo (la API lo enseña en Sistema).
 * Si deja de latir más de unas cuantas veces, la API lo da por caído.
 * @param {object} options
 * @param {{ heartbeat: (info: object) => Promise<unknown> }} options.api
 * @param {object} [options.info] Lo que se manda en cada latido (usuario, versión...).
 * @param {number} [options.intervalMs]
 * @param {() => boolean} [options.isAlive] Si devuelve false no late (p. ej. el polling se ha parado).
 * @param {import('pino').Logger} [options.logger]
 * @returns {() => void} Para el latido.
 */
export function startHeartbeat({
  api,
  info = {},
  intervalMs = 60_000,
  isAlive = () => true,
  logger,
}) {
  const startedAt = new Date().toISOString();
  let failing = false;

  async function beat() {
    if (!isAlive()) return;
    try {
      await api.heartbeat({ ...info, startedAt, intervalMs });
      if (failing) logger?.info('La API vuelve a recibir el latido');
      failing = false;
    } catch (err) {
      // Solo avisa la primera vez para no llenar el log mientras la API esté caída
      if (!failing) logger?.warn({ err }, 'No se pudo mandar el latido a la API');
      failing = true;
    }
  }

  beat();
  const timer = setInterval(beat, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
