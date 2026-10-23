import { Router } from 'express';
import { createHealthRouter } from './health.routes.js';
import { createAuthRouter } from './auth.routes.js';
import { createNutritionRouter } from './nutrition.routes.js';
import { createMealsToday } from '../services/meals-today.js';
import { createHeartbeatRouter } from './heartbeat.routes.js';
import { createConnectionsRouter, createGoogleCallbackRouter } from './connections.routes.js';
import { createMeasurementsRouter } from './measurements.routes.js';
import { createTimelineRouter } from './timeline.routes.js';
import { createTokensRouter } from './tokens.routes.js';
import { createCoachRouter } from './coach.routes.js';
import { createAiAdminRouter } from './ai-admin.routes.js';
import { createClinicalRouter } from './clinical.routes.js';
import { createSystemAdminRouter } from './system-admin.routes.js';
import { createPasskeysRouter } from './passkeys.routes.js';
import { createPushRouter } from './push.routes.js';
import { createEmailRouter } from './email.routes.js';
import { createEntriesRouter } from './entries.routes.js';
import { createEntries } from '../services/entries.js';
import { createProfileRouter } from './profile.routes.js';
import {
  authenticate,
  requireApiClient,
  requireRole,
  requireUser,
} from '../middlewares/authenticate.js';
import { Role } from '../services/users.js';

/** Rutas versionadas: /api/v1/... */
export function createApiRouter({
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
  coach,
  coachStore,
  llmUsage,
  llmBalance,
  llmModels,
  clinical,
  passkeys,
  push,
  email,
  profiles,
  engine,
}) {
  const router = Router();

  router.use('/health', createHealthRouter({ db, heartbeats, queue, pipeline }));
  router.use(
    '/auth',
    createAuthRouter({ users, sessions, passkeys, limitAttempts: config.NODE_ENV !== 'test' }),
  );

  const secureCookies = config.NODE_ENV === 'production';
  if (googleConnect) {
    router.use(
      '/connections/google-health/callback',
      createGoogleCallbackRouter({ googleConnect, secureCookies }),
    );
  }

  // Todo lo que va después exige API key (clientes) o sesión (personas)
  router.use(authenticate({ apiKeys: config.DIGITALTWIN_API_KEYS, sessions, users }));
  router.use('/heartbeat', requireApiClient, createHeartbeatRouter({ heartbeats }));
  if (passkeys) router.use('/passkeys', requireUser, createPasskeysRouter({ passkeys }));
  if (push) router.use('/push', requireUser, createPushRouter({ push }));
  if (email) {
    router.use('/email', requireUser, createEmailRouter({ email, publicUrl: config.PUBLIC_URL }));
  }
  if (profiles) router.use('/profile', requireUser, createProfileRouter({ profiles }));
  // El motor: peso tendencia, gasto real y objetivos de comida
  if (engine) {
    router.get('/engine', requireUser, async (req, res) =>
      res.json(await engine.state(req.user.id)),
    );
  }
  router.use(
    '/connections',
    requireUser,
    createConnectionsRouter({
      store: connections,
      xiaomiLogin,
      xiaomiSync,
      googleConnect,
      intervalsConnect,
      motraConnect,
      inbox,
      telegramLink,
      // El bot dice su @usuario en el latido: con él se construye el enlace t.me/<bot>?start=...
      botUsername: () => heartbeats.snapshot().bot?.username,
      backfills: pipeline && ((userId) => pipeline.store.latestBackfills(userId)),
      secureCookies,
    }),
  );
  router.use('/measurements', requireUser, createMeasurementsRouter({ measurements }));
  if (pipeline) {
    router.use(
      '/timeline',
      requireUser,
      createTimelineRouter({ queries: pipeline.queries, timeZone: config.TIMEZONE }),
    );
    // Registrar: agua, café, peso, síntomas y notas apuntados a mano
    if (queue) {
      router.use(
        '/entries',
        requireUser,
        createEntriesRouter({ entries: createEntries({ pipeline, queue }) }),
      );
    }
  }
  if (clinical) {
    router.use(
      '/clinical',
      requireUser,
      createClinicalRouter({ clinical, uploadLimit: config.CLINICAL_UPLOAD_LIMIT }),
    );
  }
  router.use('/tokens', requireUser, createTokensRouter({ tokens: personalTokens }));
  if (coach) {
    router.use(
      '/coach',
      requireUser,
      createCoachRouter({
        coach,
        store: coachStore,
        queries: pipeline.queries,
        profiles,
        engine,
        timeZone: config.TIMEZONE,
        usage: llmUsage,
      }),
    );
  }
  router.use(
    '/admin/ai',
    requireUser,
    requireRole(Role.ADMIN),
    createAiAdminRouter({
      models: llmModels,
      usage: llmUsage,
      balance: llmBalance,
      warnBelowUsd: config.LLM_BALANCE_WARN_USD,
    }),
  );
  if (pipeline) {
    router.use(
      '/admin/system',
      requireUser,
      requireRole(Role.ADMIN),
      createSystemAdminRouter({ store: pipeline.store }),
    );
  }
  const mealsToday = pipeline
    ? createMealsToday({ queries: pipeline.queries, connections, timeZone: config.TIMEZONE })
    : undefined;
  router.use('/nutrition', createNutritionRouter({ analyzer: nutritionAnalyzer, mealsToday }));

  return router;
}
