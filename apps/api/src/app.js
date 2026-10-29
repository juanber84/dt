import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { createLogger } from '@digitaltwin/logger';
import { NutritionAnalyzer } from '@digitaltwin/nutrition';
import { loadConfig } from './config/env.js';
import { createApiRouter } from './routes/index.js';
import { createHealthRouter } from './routes/health.routes.js';
import { createGoogleHealthWebhookRouter } from './routes/google-health-webhook.routes.js';
import { notFound } from './middlewares/not-found.js';
import { errorHandler } from './middlewares/error-handler.js';
import { HttpError } from './utils/http-error.js';
import { createHeartbeats } from './services/heartbeats.js';
import { createMetrics } from './services/metrics.js';
import { createXiaomiLogin } from './services/xiaomi-login.js';
import { createXiaomiSync } from './services/xiaomi-sync.js';
import {
  createMemoryMeasurementStore,
  createTimelineMeasurements,
} from './services/measurements.js';
import { createInbox } from './services/inbox.js';
import { createTelegramLink } from './services/telegram-link.js';
import { createDigitaltwinWebhookRouter } from './routes/digitaltwin-webhook.routes.js';
import { createUserStore } from './services/users.js';
import { createSessions } from './services/sessions.js';
import { createDbUserStore } from './services/users-db.js';
import { createDbPasskeyStore, createPasskeys } from './services/passkeys.js';
import { createDbPushStore, createPush } from '@digitaltwin/push';
import { createDbEmailStore, createEmail, createResendTransport } from '@digitaltwin/email';
import { createDbReportStore, createReports } from '@digitaltwin/reports';
import { createEngine, createProfiles, createSupplements } from '@digitaltwin/engine';
import {
  createDbConnectionStore,
  createMemoryConnectionStore,
  createSecretBox,
} from '@digitaltwin/connections';
import { createGoogleConnect } from './services/google-connect.js';
import { createIntervalsConnect } from './services/intervals-connect.js';
import { createMotraConnect, createMotraClients } from './services/motra-connect.js';
import { createDbPersonalTokens, createMemoryPersonalTokens } from './services/personal-tokens.js';
import { createMcpRouter } from './routes/mcp.routes.js';
import { randomBytes } from 'node:crypto';
import { createChatClient, createCoach } from '@digitaltwin/coach';
import { createDbCoachStore, createMemoryCoachStore } from './services/coach-store.js';
import {
  createDbLlmUsageRows,
  createLlmUsage,
  createMemoryLlmUsageRows,
} from './services/llm-usage.js';
import { createDeepseekBalance, hasBalanceEndpoint } from './services/llm-balance.js';
import { createAiAccess, createDbAiStore, createMemoryAiStore } from '@digitaltwin/llm-usage';
import { createAi } from './services/ai.js';
import { createDbClinicalStore, createMemoryClinicalStore } from '@digitaltwin/clinical';
import { createClinical } from './services/clinical.js';

/**
 * Construye la app Express sin arrancar el servidor (facilita los tests).
 * @param {object} [deps]
 * @param {ReturnType<typeof loadConfig>} [deps.config]
 * @param {import('pino').Logger} [deps.logger]
 * @param {(notifications: import('@digitaltwin/google-health').HealthNotification[]) => (void|Promise<void>)} [deps.onHealthNotifications]
 *   Qué hacer con los avisos de Google Health (encolar, guardar...). Por defecto solo se registran en el log.
 * @param {object} [deps.googleHealthWebhook]  Opciones extra del handler (p. ej. keyset en tests).
 * @param {Pick<NutritionAnalyzer, 'analyze' | 'refine'>} [deps.nutritionAnalyzer]
 *   Estimador de macros. Por defecto se crea con LLM_* si hay LLM_API_KEY.
 * @param {import('postgres').Sql} [deps.db]  Conexión a la BD (la crea server.js con DATABASE_URL).
 * @param {ReturnType<typeof createHeartbeats>} [deps.heartbeats]  Latidos de los servicios (el bot).
 * @param {ReturnType<typeof createMemoryConnectionStore>} [deps.connections]  Conexiones con
 *   proveedores. Por defecto, en la BD si hay TOKEN_ENCRYPTION_KEY; si no, en memoria.
 * @param {object} [deps.xiaomiAuth]  Para tests: sustituye a XiaomiAuth en el login.
 * @param {Function} [deps.xiaomiDescribeAccount]  Para tests: sustituye la lectura de las básculas.
 * @param {ReturnType<typeof createUserStore>} [deps.users]  Usuarios. Por defecto, los de la BD.
 * @param {ReturnType<typeof createMemoryMeasurementStore>} [deps.measurements]  Mediciones crudas.
 *   Por defecto, los pesajes del timeline si hay pipeline; si no, en memoria.
 * @param {ReturnType<typeof import('@digitaltwin/queue').createQueue>} [deps.queue]  Cola del
 *   worker (la crea server.js con la BD). Con ella y el pipeline, todo lo que entra va al worker.
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createPipeline>} [deps.pipeline]
 *   Timeline normalizado (raw_records, observations, episodes).
 * @param {Function} [deps.xiaomiFetchMeasurements]  Para tests: sustituye la descarga de Xiaomi.
 * @param {object} [deps.googleAuth]  Para tests: sustituye a GoogleHealthAuth.
 * @param {Function} [deps.googleDescribeAccount]  Para tests: sustituye la lectura de dispositivos.
 * @param {ReturnType<typeof createMemoryPersonalTokens>} [deps.personalTokens]  Tokens personales
 *   (MCP). Por defecto, en la BD si la hay; si no, en memoria.
 * @param {ReturnType<typeof createChatClient>} [deps.coachLlm]  LLM del coach. Por defecto se crea
 *   con COACH_LLM_* si hay clave.
 * @param {ReturnType<typeof createMemoryCoachStore>} [deps.coachStore]  Conversaciones del coach.
 * @param {ReturnType<typeof createLlmUsage>} [deps.llmUsage]  Cuenta del gasto en LLM.
 * @param {ReturnType<typeof createAiAccess>} [deps.aiAccess]  Límite de IA por usuario y claves
 *   propias. Por defecto, en la BD si la hay; si no, en memoria.
 * @param {ReturnType<typeof createDeepseekBalance> | null} [deps.llmBalance]  Saldo del proveedor
 *   (null = no se consulta). Por defecto, el de DeepSeek si es DeepSeek.
 * @param {ReturnType<typeof createMemoryClinicalStore>} [deps.clinicalStore]  Informes médicos.
 *   Por defecto, en la BD si la hay; si no, en memoria.
 * @param {ReturnType<typeof createPasskeys>} [deps.passkeys]  Entrar con Face ID. Por defecto, con
 *   la BD si la hay; sin BD no se ofrece.
 * @param {(options: object) => object} [deps.motraClient]  Cliente de Motra de mentira (tests)
 * @param {ReturnType<typeof createPush>} [deps.push]  Avisos push. Por defecto, con la BD y las
 *   claves VAPID; sin ellas no se ofrecen.
 * @param {ReturnType<typeof createEmail>} [deps.email]  Correos. Por defecto, con la BD y la clave
 *   de Resend; sin ellas no se ofrecen.
 * @param {ReturnType<typeof createReports>} [deps.reports]  Informes. Por defecto, con la BD y el
 *   motor; sin ellos no se ofrecen.
 */
export function createApp({
  config = loadConfig(),
  logger,
  onHealthNotifications,
  googleHealthWebhook,
  nutritionAnalyzer,
  db,
  heartbeats = createHeartbeats(),
  connections,
  xiaomiAuth,
  xiaomiDescribeAccount,
  users,
  measurements,
  queue,
  pipeline,
  xiaomiFetchMeasurements,
  googleAuth,
  googleDescribeAccount,
  intervalsClient,
  motraSignIn,
  motraClient,
  personalTokens,
  coachLlm,
  coachStore,
  llmUsage,
  aiAccess,
  llmBalance,
  clinicalStore,
  passkeys,
  push,
  email,
  reports,
} = {}) {
  const log = logger ?? createLogger({ name: 'api', level: config.LOG_LEVEL });
  if (!config.JWT_SECRET && config.NODE_ENV !== 'test') {
    log.warn('Sin JWT_SECRET: las sesiones se pierden cada vez que se reinicia la API');
  }
  users ??= db ? createDbUserStore({ db }) : createUserStore();
  if (!db && config.NODE_ENV !== 'test') log.warn('Sin BD no hay usuarios: nadie puede entrar');
  connections ??= createConnectionStore({ db, config, log });
  personalTokens ??= db ? createDbPersonalTokens({ db }) : createMemoryPersonalTokens();
  const usageRows = db ? createDbLlmUsageRows({ db }) : createMemoryLlmUsageRows();
  llmUsage ??= createLlmUsage({
    rows: usageRows,
    prices: config.LLM_PRICES,
    timeZone: config.TIMEZONE,
    logger: log.child({ module: 'llm-usage' }),
  });
  nutritionAnalyzer ??= createNutritionAnalyzer(config, llmUsage);
  coachLlm ??= createCoachLlm(config);
  aiAccess ??= createAiAccess({
    store: db ? createDbAiStore({ db }) : createMemoryAiStore({ users, usage: usageRows }),
    box: config.TOKEN_ENCRYPTION_KEY ? createSecretBox(config.TOKEN_ENCRYPTION_KEY) : undefined,
    defaultLimitUsd: config.AI_DAILY_LIMIT_USD,
    timeZone: config.TIMEZONE,
  });
  const ai = createAi({
    access: aiAccess,
    coachLlm,
    nutritionAnalyzer,
    timeZone: config.TIMEZONE,
    onUsage: (entry) => llmUsage.record(entry),
  });
  // El coach lee el timeline: sin pipeline (BD) no hay datos que consultar. El LLM sale de cada
  // usuario (su clave o la de la app), así que se monta aunque la app no tenga clave.
  const newCoach = pipeline
    ? (llm) =>
        createCoach({
          llm,
          timeZone: config.TIMEZONE,
          maxSteps: config.COACH_MAX_STEPS,
          logger: log.child({ module: 'coach' }),
        })
    : undefined;
  coachStore ??= db ? createDbCoachStore({ db }) : createMemoryCoachStore();
  if (llmBalance === undefined) {
    llmBalance =
      config.LLM_API_KEY && hasBalanceEndpoint(config.LLM_BASE_URL)
        ? createDeepseekBalance({ apiKey: config.LLM_API_KEY, baseUrl: config.LLM_BASE_URL })
        : null;
  }
  // Los PDF los lee el worker: sin cola ni pipeline (BD) no hay informes
  clinicalStore ??= db ? createDbClinicalStore({ db }) : createMemoryClinicalStore();
  const clinical =
    pipeline && queue
      ? createClinical({
          store: clinicalStore,
          queue,
          pipeline,
          timeZone: config.TIMEZONE,
          logger: log.child({ module: 'clinical' }),
        })
      : undefined;
  const llmModels = [
    {
      feature: 'nutrition',
      model: config.LLM_MODEL,
      baseUrl: config.LLM_BASE_URL,
      configured: Boolean(nutritionAnalyzer),
    },
    {
      feature: 'coach',
      model: config.COACH_LLM_MODEL,
      baseUrl: config.COACH_LLM_BASE_URL,
      configured: Boolean(newCoach && coachLlm),
    },
    // Lo usa el worker con las mismas LLM_* (se lee de Infisical igual que la API)
    {
      feature: 'clinical',
      model: config.LLM_MODEL,
      baseUrl: config.LLM_BASE_URL,
      configured: Boolean(clinical && config.LLM_API_KEY),
    },
  ];
  // Vincular Telegram va por el webhook del bot, que solo existe con el pipeline (BD + cola)
  const telegramLink =
    pipeline && queue && config.DIGITALTWIN_WEBHOOK_SECRET
      ? createTelegramLink({ connections, users })
      : undefined;
  const inbox =
    pipeline && queue
      ? createInbox({
          pipeline,
          queue,
          connections,
          telegramLink,
          timeZone: config.TIMEZONE,
          logger: log.child({ module: 'inbox' }),
        })
      : undefined;
  onHealthNotifications ??= inbox?.googleNotifications;
  measurements ??= pipeline
    ? createTimelineMeasurements(pipeline.queries)
    : createMemoryMeasurementStore();
  const sessionSecret = config.JWT_SECRET ?? randomBytes(32).toString('hex');
  const sessions = createSessions({
    secret: sessionSecret,
    secure: config.NODE_ENV === 'production',
  });
  passkeys ??= db
    ? createPasskeys({
        store: createDbPasskeyStore({ db }),
        publicUrl: config.PUBLIC_URL,
        // En desarrollo el front de Vite (5173) también vale; el dominio es localhost igual
        extraOrigins: config.NODE_ENV === 'production' ? [] : ['http://localhost:5173'],
        secret: sessionSecret,
        secure: config.NODE_ENV === 'production',
      })
    : undefined;
  const profiles = db ? createProfiles({ db, timeZone: config.TIMEZONE }) : undefined;
  const supplements = db ? createSupplements({ db }) : undefined;
  const engine =
    profiles && pipeline
      ? createEngine({
          queries: pipeline.queries,
          profiles,
          supplements,
          timeZone: config.TIMEZONE,
        })
      : undefined;
  push ??=
    db && config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY
      ? createPush({
          store: createDbPushStore({ db }),
          vapid: {
            publicKey: config.VAPID_PUBLIC_KEY,
            privateKey: config.VAPID_PRIVATE_KEY,
            // https: o mailto: (con localhost en desarrollo, web-push no acepta la URL)
            subject:
              config.VAPID_SUBJECT ??
              (config.PUBLIC_URL.startsWith('https://')
                ? config.PUBLIC_URL
                : 'mailto:admin@localhost'),
          },
          timeZone: config.TIMEZONE,
          logger: log.child({ module: 'push' }),
        })
      : undefined;
  email ??=
    db && config.RESEND_API_KEY
      ? createEmail({
          store: createDbEmailStore({ db }),
          transport: createResendTransport({ apiKey: config.RESEND_API_KEY }),
          from: config.EMAIL_FROM,
          logger: log.child({ module: 'email' }),
        })
      : undefined;
  // Informes: los mismos que hace el worker cada mañana (aquí, a mano y para verlos)
  reports ??=
    db && engine
      ? createReports({
          store: createDbReportStore({ db }),
          queries: pipeline.queries,
          engine,
          profiles,
          chatFor: (userId) => ai.chat(userId).then(({ llm, own }) => ({ chat: llm, own })),
          email,
          appUrl: config.PUBLIC_URL,
          timeZone: config.TIMEZONE,
          onUsage: (entry) => llmUsage.record(entry),
          logger: log.child({ module: 'reports' }),
        })
      : undefined;
  const xiaomiLogin = createXiaomiLogin({
    store: connections,
    onConnected: inbox?.connected,
    auth: xiaomiAuth,
    describeAccount: xiaomiDescribeAccount,
    logger: log.child({ provider: 'xiaomi' }),
  });
  // intervals.icu solo lo sincroniza el worker: sin cola (sin BD) no se ofrece
  const intervalsConnect = inbox
    ? createIntervalsConnect({
        store: connections,
        onConnected: inbox.connected,
        ...(intervalsClient && { createClient: intervalsClient }),
        logger: log.child({ provider: 'intervals-icu' }),
      })
    : undefined;
  // Motra: igual que intervals, solo lo sincroniza el worker (sin cola no se ofrece), y hace
  // falta la API key de Firebase de su app
  const motraConnect =
    inbox && (config.MOTRA_FIREBASE_API_KEY || motraSignIn)
      ? createMotraConnect({
          store: connections,
          onConnected: inbox.connected,
          apiKey: config.MOTRA_FIREBASE_API_KEY,
          ...(motraSignIn && { signIn: motraSignIn }),
          logger: log.child({ provider: 'motra' }),
        })
      : undefined;
  const googleConnect =
    config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
      ? createGoogleConnect({
          oauth: { clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET },
          publicUrl: config.PUBLIC_URL,
          store: connections,
          onConnected: inbox?.connected,
          auth: googleAuth,
          describeAccount: googleDescribeAccount,
          logger: log.child({ provider: 'google-health' }),
        })
      : undefined;
  const xiaomiSync = createXiaomiSync({
    store: connections,
    measurements,
    fetchMeasurements: xiaomiFetchMeasurements,
    logger: log.child({ provider: 'xiaomi' }),
  });
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);

  // Logging + request id (reutiliza X-Request-Id si viene del cliente/proxy)
  app.use(
    pinoHttp({
      logger: log,
      genReqId: (req, res) => {
        const id = req.headers['x-request-id'] ?? randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      autoLogging: {
        ignore: (req) => req.url.startsWith('/health') || req.url.startsWith('/metrics'),
      },
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  const metrics = createMetrics({ heartbeats, queue, pipeline, logger: log });
  app.use(metrics.httpMiddleware);

  // Seguridad
  app.use(helmet());
  app.use(
    cors({
      origin: config.CORS_ORIGINS.includes('*')
        ? true
        : (origin, cb) => {
            // Peticiones sin Origin (curl, server-to-server) se permiten
            if (!origin || config.CORS_ORIGINS.includes(origin)) return cb(null, true);
            cb(
              HttpError.forbidden(`Origen no permitido por CORS: ${origin}`, {
                code: 'CORS_FORBIDDEN',
              }),
            );
          },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy'],
      maxAge: 600,
    }),
  );

  app.use(compression());

  // Webhooks: necesitan el body crudo (firma), así que van antes de express.json y sin rate limit
  if (config.GOOGLE_HEALTH_WEBHOOK_SECRET) {
    app.use(
      '/webhooks/google-health',
      createGoogleHealthWebhookRouter({
        secret: config.GOOGLE_HEALTH_WEBHOOK_SECRET,
        bodyLimit: config.BODY_LIMIT,
        onNotifications: onHealthNotifications,
        ...googleHealthWebhook,
      }),
    );
  }

  // Eventos de nuestras apps (el bot), firmados con DIGITALTWIN_WEBHOOK_SECRET
  if (config.DIGITALTWIN_WEBHOOK_SECRET && inbox) {
    app.use(
      '/webhooks/digitaltwin',
      createDigitaltwinWebhookRouter({
        secret: config.DIGITALTWIN_WEBHOOK_SECRET,
        bodyLimit: config.NUTRITION_BODY_LIMIT,
        inbox,
      }),
    );
  }

  // Las fotos en base64 no caben en el límite general
  app.use('/api/v1/nutrition', express.json({ limit: config.NUTRITION_BODY_LIMIT }));

  // Parsing
  app.use(express.json({ limit: config.BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: config.BODY_LIMIT }));

  // Health fuera del rate limit (para k8s / balanceadores). /health es liveness: no mira la BD,
  // así un fallo de la BD no hace que Docker reinicie la API.
  app.use('/health', createHealthRouter());
  // Para Grafana (lo lee digitaltwin-alloy por la red de Docker). nginx solo reenvía /api y
  // /webhooks, así que desde fuera no se ve.
  app.get('/metrics', metrics.handler);

  app.use(
    '/api',
    rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      limit: config.RATE_LIMIT_MAX,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: () => config.NODE_ENV === 'test',
      handler: (_req, _res, next) =>
        next(new HttpError(429, 'Demasiadas peticiones, inténtalo más tarde')),
    }),
  );

  // MCP para clientes de IA (Claude Code, Desktop...) con token personal. Bajo /api para que pase
  // por el mismo proxy que el resto.
  if (pipeline) {
    app.use(
      '/api/mcp',
      createMcpRouter({
        tokens: personalTokens,
        users,
        queries: pipeline.queries,
        profiles,
        engine,
        timeZone: config.TIMEZONE,
        // Las plantillas de fuerza solo necesitan la conexión y la API key (no la cola)
        ...((config.MOTRA_FIREBASE_API_KEY || motraClient) && {
          motra: createMotraClients({
            store: connections,
            apiKey: config.MOTRA_FIREBASE_API_KEY,
            ...(motraClient && { createClient: motraClient }),
          }),
        }),
      }),
    );
  }

  app.use(
    '/api/v1',
    createApiRouter({
      config,
      nutritionAnalyzer,
      db,
      heartbeats,
      connections,
      xiaomiLogin,
      xiaomiSync,
      googleConnect,
      intervalsConnect,
      motraConnect,
      measurements,
      users,
      sessions,
      inbox,
      queue,
      pipeline,
      telegramLink,
      personalTokens,
      newCoach,
      coachStore,
      ai,
      llmUsage,
      llmBalance,
      llmModels,
      clinical,
      passkeys,
      push,
      email,
      reports,
      profiles,
      supplements,
      engine,
    }),
  );

  app.use(notFound);
  app.use(errorHandler({ isProduction: config.NODE_ENV === 'production' }));

  return app;
}

function createNutritionAnalyzer(config, llmUsage) {
  if (!config.LLM_API_KEY) return undefined;
  return new NutritionAnalyzer({
    onUsage: (entry) => llmUsage.record(entry),
    apiKey: config.LLM_API_KEY,
    baseUrl: config.LLM_BASE_URL,
    model: config.LLM_MODEL,
    timeZone: config.TIMEZONE,
    // El campo `thinking` es propio de DeepSeek; otros proveedores lo rechazarían
    ...(config.LLM_BASE_URL.includes('deepseek.com') ? {} : { extraBody: {} }),
  });
}

function createCoachLlm(config) {
  if (!config.COACH_LLM_API_KEY) return undefined;
  return createChatClient({
    apiKey: config.COACH_LLM_API_KEY,
    baseUrl: config.COACH_LLM_BASE_URL,
    model: config.COACH_LLM_MODEL,
    // Sin thinking: más rápido y barato, y DeepSeek no lo mezcla bien con las herramientas
    extraBody: config.COACH_LLM_BASE_URL.includes('deepseek.com')
      ? { thinking: { type: 'disabled' } }
      : {},
  });
}

/** Las credenciales solo se guardan en la BD cifradas: sin clave, las conexiones viven en memoria. */
function createConnectionStore({ db, config, log }) {
  if (db && config.TOKEN_ENCRYPTION_KEY) {
    return createDbConnectionStore({
      db,
      box: createSecretBox(config.TOKEN_ENCRYPTION_KEY),
      logger: log,
    });
  }
  if (db && config.NODE_ENV !== 'test') {
    log.warn(
      'Sin TOKEN_ENCRYPTION_KEY: las conexiones se guardan en memoria y se pierden al reiniciar',
    );
  }
  return createMemoryConnectionStore();
}
