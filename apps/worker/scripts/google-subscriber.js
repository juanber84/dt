#!/usr/bin/env node
/**
 * El suscriptor de webhooks de Google Health a mano (el worker ya lo mantiene solo):
 *
 *   node scripts/google-subscriber.js              estado y entregas de las últimas 24 h
 *   node scripts/google-subscriber.js --force      lo reescribe (tras cambiar el secreto)
 *   node scripts/google-subscriber.js --recreate   lo borra y lo crea de nuevo
 *
 * Con --force o --recreate también deja una suscripción MANUAL por usuario conectado, como el
 * trabajo google-subscriber del worker. --recreate es para cuando Google deja de entregar avisos
 * con el suscriptor activo (pasó el 24-10-2026). Los avisos pendientes se pierden, pero los datos
 * siguen entrando por la sincronización de cada hora.
 *
 * En producción: docker exec digitaltwin-worker digitaltwin-run /api node scripts/google-subscriber.js
 */
import { parseArgs } from 'node:util';
import { GoogleHealthSubscribers } from '@digitaltwin/google-health';
import { createDb } from '@digitaltwin/db';
import { createDbConnectionStore, createSecretBox } from '@digitaltwin/connections';
import { loadConfig } from '../src/config/env.js';
import { GOOGLE_SUBSCRIBER_ID, googleSubscriptionsFor } from '../src/jobs.js';
import { GOOGLE } from '../src/providers/google.js';

const { values } = parseArgs({
  options: { force: { type: 'boolean' }, recreate: { type: 'boolean' } },
});

const config = loadConfig();
const projectId =
  config.GOOGLE_CLOUD_PROJECT_NUMBER ?? config.GOOGLE_CLIENT_ID?.match(/^(\d+)-/)?.[1];
if (!projectId || !config.GOOGLE_HEALTH_SERVICE_ACCOUNT || !config.GOOGLE_HEALTH_WEBHOOK_SECRET) {
  console.error('Faltan GOOGLE_HEALTH_SERVICE_ACCOUNT, GOOGLE_HEALTH_WEBHOOK_SECRET o el proyecto');
  process.exit(1);
}
const subscribers = new GoogleHealthSubscribers({
  projectId,
  credentials: config.GOOGLE_HEALTH_SERVICE_ACCOUNT,
});
const target = {
  subscriberId: GOOGLE_SUBSCRIBER_ID,
  endpointUri: `${config.PUBLIC_URL}/webhooks/google-health`,
  secret: config.GOOGLE_HEALTH_WEBHOOK_SECRET,
};

if (values.recreate) {
  await subscribers.delete(GOOGLE_SUBSCRIBER_ID, { force: true });
  console.log('borrado');
}
if (values.recreate || values.force) {
  const { action } = await subscribers.ensure({ ...target, policy: 'MANUAL', force: true });
  console.log(`suscriptor: ${action}`);
  const db = createDb(config.DATABASE_URL, { max: 1 });
  const connections = createDbConnectionStore({
    db,
    box: createSecretBox(config.TOKEN_ENCRYPTION_KEY),
  });
  const wanted = googleSubscriptionsFor(await connections.listByProvider(GOOGLE));
  console.log(
    'suscripciones:',
    await subscribers.ensureSubscriptions(GOOGLE_SUBSCRIBER_ID, wanted),
  );
  await db.end();
}

const current = (await subscribers.list()).find((s) =>
  s.name?.endsWith(`/subscribers/${GOOGLE_SUBSCRIBER_ID}`),
);
console.log(
  current
    ? `${current.state} → ${current.endpointUri} (creado ${current.createTime}, cambiado ${current.updateTime})`
    : 'no existe',
);
if (current) {
  for (const c of current.subscriberConfigs ?? []) {
    console.log(`  ${c.subscriptionCreatePolicy}: ${c.dataTypes?.length ?? 0} tipos`);
  }
  for (const sub of await subscribers.listSubscriptions(GOOGLE_SUBSCRIBER_ID)) {
    console.log(
      `  suscripción ${sub.name.split('/').at(-1)} → ${sub.user} (${sub.dataTypes?.length ?? 0} tipos)`,
    );
  }
}

try {
  const deliveries = await subscribers.deliveries({ since: Date.now() - 24 * 3600 * 1000 });
  const byHour = {};
  for (const d of deliveries) {
    const key = `${d.at.slice(0, 13)}:00Z ${d.status ?? '?'}`;
    byHour[key] = (byHour[key] ?? 0) + 1;
  }
  console.log(`entregas en 24 h: ${deliveries.length}`);
  for (const [key, n] of Object.entries(byHour)) console.log(`  ${key} × ${n}`);
} catch (err) {
  console.log(`entregas: no se pueden leer (${err.message}); hace falta el rol Visor de registros`);
}
process.exit(0);
