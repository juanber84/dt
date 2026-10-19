import { Router } from 'express';
import { createHealthRouter } from './health.routes.js';
import { createAuthRouter } from './auth.routes.js';
import { createNutritionRouter } from './nutrition.routes.js';
import { createHeartbeatRouter } from './heartbeat.routes.js';
import { createConnectionsRouter, createGoogleCallbackRouter } from './connections.routes.js';
import { createMeasurementsRouter } from './measurements.routes.js';
import { createTimelineRouter } from './timeline.routes.js';
import { createTokensRouter } from './tokens.routes.js';
import { createCoachRouter } from './coach.routes.js';
import { createAiAdminRouter } from './ai-admin.routes.js';
import { createClinicalRouter } from './clinical.routes.js';
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
}) {
  const router = Router();

  router.use('/health', createHealthRouter({ db, heartbeats, queue, pipeline }));
  router.use(
    '/auth',
    createAuthRouter({ users, sessions, limitAttempts: config.NODE_ENV !== 'test' }),
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
  router.use(
    '/connections',
    requireUser,
    createConnectionsRouter({
      store: connections,
      xiaomiLogin,
      xiaomiSync,
      googleConnect,
      intervalsConnect,
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
  router.use('/nutrition', createNutritionRouter({ analyzer: nutritionAnalyzer }));

  return router;
}
