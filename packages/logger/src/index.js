import pino from 'pino';

const LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

/**
 * Crea un logger pino con valores por defecto razonables.
 * En desarrollo usa pino-pretty si está disponible; en producción emite JSON.
 *
 * @param {object} [options]
 * @param {string} [options.name] Nombre del servicio/proceso.
 * @param {string} [options.level] Nivel de log (por defecto LOG_LEVEL o 'info').
 * @param {boolean} [options.pretty] Fuerza (o desactiva) la salida legible.
 * @param {import('pino').DestinationStream} [destination] Stream de salida (útil en tests).
 */
export function createLogger(options = {}, destination) {
  const level = options.level ?? process.env.LOG_LEVEL ?? 'info';
  if (!LEVELS.includes(level)) {
    throw new Error(`Nivel de log inválido: "${level}". Valores permitidos: ${LEVELS.join(', ')}`);
  }

  const pretty = options.pretty ?? process.env.NODE_ENV === 'development';

  const pinoOptions = {
    name: options.name,
    level,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
      censor: '[REDACTED]',
    },
    ...(pretty && !destination
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  };

  return destination ? pino(pinoOptions, destination) : pino(pinoOptions);
}

export { LEVELS };
