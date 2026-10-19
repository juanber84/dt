import { createLogger } from '@digitaltwin/logger';
import { createDb, migrate } from '@digitaltwin/db';
import { createQueue } from '@digitaltwin/queue';
import { createPipeline } from '@digitaltwin/timeline';
import { loadConfig } from './config/env.js';
import { createApp } from './app.js';

const config = loadConfig();
const logger = createLogger({ name: 'api', level: config.LOG_LEVEL });

// Migraciones al arrancar: si fallan, la API no arranca (mejor que servir con el esquema a medias)
const db = config.DATABASE_URL ? createDb(config.DATABASE_URL) : undefined;
if (db) await migrate(db, { logger });
else logger.warn('Sin DATABASE_URL: la API arranca sin BD');

// Con BD, la API encola y el worker (apps/worker) hace el trabajo
let queue;
let pipeline;
if (db) {
  queue = createQueue({ connectionString: config.DATABASE_URL, logger });
  await queue.start();
  pipeline = createPipeline({ db, queue, timeZone: config.TIMEZONE, logger });
}

const app = createApp({ config, logger, db, queue, pipeline });

const server = app.listen(config.PORT, () => {
  logger.info(`API escuchando en http://localhost:${config.PORT} (${config.NODE_ENV})`);
});

// Cierre ordenado: deja de aceptar conexiones y termina las en curso
function shutdown(signal) {
  logger.info(`${signal} recibido, cerrando servidor...`);
  server.close((err) => {
    if (err) {
      logger.error({ err }, 'Error cerrando el servidor');
      process.exit(1);
    }
    logger.info('Servidor cerrado');
    Promise.resolve(queue?.stop())
      .then(() => db?.end({ timeout: 5 }))
      .finally(() => process.exit(0));
  });
  setTimeout(() => {
    logger.error('Cierre forzado tras timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Promesa rechazada sin capturar');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Excepción no capturada');
  process.exit(1);
});
