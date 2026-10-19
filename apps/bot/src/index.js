import { createLogger } from '@digitaltwin/logger';
import { loadConfig } from './config/env.js';
import { createBot } from './bot.js';
import { createApiClient } from './api-client.js';
import { startHeartbeat } from './heartbeat.js';
import pkg from '../package.json' with { type: 'json' };

const config = loadConfig();
const logger = createLogger({ name: 'bot', level: config.LOG_LEVEL });

const api = createApiClient({
  baseUrl: config.API_URL,
  apiKey: config.DIGITALTWIN_API_KEY,
  webhookSecret: config.DIGITALTWIN_WEBHOOK_SECRET,
});
if (!config.DIGITALTWIN_WEBHOOK_SECRET) {
  logger.warn('Sin DIGITALTWIN_WEBHOOK_SECRET: las comidas no se guardan en el timeline');
}
const bot = createBot({
  token: config.TELEGRAM_BOT_TOKEN,
  api,
  allowedUserIds: config.TELEGRAM_ALLOWED_USER_IDS,
  timeZone: config.TIMEZONE,
  logger,
});

if (config.TELEGRAM_ALLOWED_USER_IDS.length === 0) {
  logger.warn(
    'TELEGRAM_ALLOWED_USER_IDS vacío: modo configuración, el bot solo contesta a cada uno con su ID',
  );
}

await bot.api.setMyCommands([
  { command: 'help', description: 'Cómo usar el bot' },
  { command: 'vincular', description: 'Vincula tu cuenta con el código de la web' },
]);

let stopHeartbeat = () => {};

// Long polling: no necesita webhook ni exponer puertos
bot.start({
  allowed_updates: ['message', 'callback_query'],
  onStart: (me) => {
    logger.info(`Bot @${me.username} escuchando (long polling)`);
    stopHeartbeat = startHeartbeat({
      api,
      info: { username: me.username, version: pkg.version },
      isAlive: () => bot.isRunning(),
      logger,
    });
  },
});

function shutdown(signal) {
  logger.info(`${signal} recibido, parando el bot...`);
  stopHeartbeat();
  bot.stop().then(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Promesa rechazada sin capturar');
});
