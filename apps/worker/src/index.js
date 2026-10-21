import { hostname } from 'node:os';
import { createLogger } from '@digitaltwin/logger';
import { createDb, migrate } from '@digitaltwin/db';
import { createQueue } from '@digitaltwin/queue';
import { createPipeline } from '@digitaltwin/timeline';
import { createDbConnectionStore, createSecretBox } from '@digitaltwin/connections';
import { loadConfig } from './config/env.js';
import { createRateLimiter } from './rate-limit.js';
import { createXiaomiProvider } from './providers/xiaomi.js';
import { createGoogleProvider } from './providers/google.js';
import { createIntervalsProvider } from './providers/intervals.js';
import { createJobs } from './jobs.js';
import { GoogleHealthSubscribers } from '@digitaltwin/google-health';
import { ClinicalExtractor, createDbClinicalStore } from '@digitaltwin/clinical';
import { createDbLlmUsageRows, createUsageRecorder } from '@digitaltwin/llm-usage';
import { createClinicalProcessor } from './clinical.js';
import pkg from '../package.json' with { type: 'json' };

const HEARTBEAT_MS = 30_000;

const config = loadConfig();
const logger = createLogger({ name: 'worker', level: config.LOG_LEVEL });

const db = createDb(config.DATABASE_URL);
await migrate(db, { logger });

const queue = createQueue({ connectionString: config.DATABASE_URL, worker: true, logger });
await queue.start();

const pipeline = createPipeline({ db, queue, timeZone: config.TIMEZONE, logger });
await pipeline.catalog.ready();
const connections = createDbConnectionStore({
  db,
  box: createSecretBox(config.TOKEN_ENCRYPTION_KEY),
  logger,
});
const limiter = createRateLimiter({
  store: pipeline.store,
  perMinute: {
    'google-health': config.GOOGLE_REQUESTS_PER_MINUTE,
    xiaomi: config.XIAOMI_REQUESTS_PER_MINUTE,
    'intervals-icu': config.INTERVALS_REQUESTS_PER_MINUTE,
  },
});

const providers = {
  xiaomi: createXiaomiProvider({
    connections,
    pipeline,
    limiter,
    logger: logger.child({ provider: 'xiaomi' }),
  }),
  intervals: createIntervalsProvider({
    connections,
    pipeline,
    limiter,
    timeZone: config.TIMEZONE,
    backfillDays: config.INTERVALS_BACKFILL_DAYS,
    logger: logger.child({ provider: 'intervals-icu' }),
  }),
  google:
    config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
      ? createGoogleProvider({
          connections,
          pipeline,
          queue,
          limiter,
          oauth: { clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET },
          timeZone: config.TIMEZONE,
          logger: logger.child({ provider: 'google-health' }),
        })
      : undefined,
};
if (!providers.google) logger.warn('Sin GOOGLE_CLIENT_ID/SECRET: Google no se sincroniza');

const recordUsage = createUsageRecorder({
  rows: createDbLlmUsageRows({ db }),
  prices: config.LLM_PRICES,
  logger,
});
const clinical = createClinicalProcessor({
  store: createDbClinicalStore({ db }),
  extractor: config.LLM_API_KEY
    ? new ClinicalExtractor({
        apiKey: config.LLM_API_KEY,
        baseUrl: config.LLM_BASE_URL,
        model: config.LLM_MODEL,
        onUsage: recordUsage,
        // El campo `thinking` es propio de DeepSeek; otros proveedores lo rechazarían
        ...(config.LLM_BASE_URL.includes('deepseek.com') ? {} : { extraBody: {} }),
      })
    : undefined,
  logger: logger.child({ module: 'clinical' }),
});
if (!config.LLM_API_KEY) logger.warn('Sin LLM_API_KEY: los informes médicos no se leen');

// Solo con URL pública (Google no avisa a localhost), secreto y cuenta de servicio
const googleSubscribers =
  config.PUBLIC_URL?.startsWith('https://') &&
  config.GOOGLE_HEALTH_WEBHOOK_SECRET &&
  config.GOOGLE_HEALTH_SERVICE_ACCOUNT
    ? new GoogleHealthSubscribers({
        projectId: config.GOOGLE_HEALTH_SERVICE_ACCOUNT.project_id,
        credentials: config.GOOGLE_HEALTH_SERVICE_ACCOUNT,
      })
    : undefined;
if (!googleSubscribers) logger.info('Sin suscriptor de webhooks de Google: solo el cron');

const jobs = createJobs({
  queue,
  pipeline,
  connections,
  providers,
  clinical,
  googleSubscribers,
  config,
  logger,
});
await jobs.start();
logger.info('Worker en marcha');

// Latido en la BD: la página de Sistema sabe si el worker está vivo y qué ha hecho
const worker = {
  workerId: `${hostname()}:${process.pid}`,
  hostname: hostname(),
  version: pkg.version,
  startedAt: new Date().toISOString(),
  intervalMs: HEARTBEAT_MS,
};
const beat = () =>
  pipeline.store
    .workerBeat({ ...worker, stats: jobs.stats() })
    .catch((err) => logger.warn({ err }, 'No se pudo apuntar el latido'));
await beat();
const heartbeat = setInterval(beat, HEARTBEAT_MS);
heartbeat.unref();

// Cierre ordenado: termina los trabajos en curso (hasta 20 s) y cierra la BD
let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  logger.info(`${signal} recibido, cerrando worker...`);
  setTimeout(() => {
    logger.error('Cierre forzado tras timeout');
    process.exit(1);
  }, 30_000).unref();
  clearInterval(heartbeat);
  try {
    await queue.stop();
    await db.end({ timeout: 5 });
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error cerrando el worker');
    process.exit(1);
  }
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
