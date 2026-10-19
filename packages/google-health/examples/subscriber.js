#!/usr/bin/env node
/**
 * Administra el suscriptor de webhooks del proyecto (se hace una vez, no por usuario).
 * Necesita una cuenta de servicio con rol "Google Health API Editor" en el proyecto:
 *   GOOGLE_APPLICATION_CREDENTIALS=/ruta/service-account.json
 *   GOOGLE_CLOUD_PROJECT_NUMBER=579742134918
 *
 *   node examples/subscriber.js list
 *   GOOGLE_HEALTH_WEBHOOK_SECRET="Bearer xxx" node examples/subscriber.js create --id digitaltwin --url https://xxx.trycloudflare.com/webhooks/google-health
 *   node examples/subscriber.js delete --id digitaltwin
 *
 * Al crear, Google llama al endpoint para verificarlo: el webhook-server (o la API) tiene que estar arriba.
 */
import { GoogleHealthSubscribers, WEBHOOK_DATA_TYPES } from '../src/index.js';
import { parseArgs, fail } from './_shared.js';

const args = parseArgs();
const [command = 'list'] = args._;
const projectId = args.project ?? process.env.GOOGLE_CLOUD_PROJECT_NUMBER;
if (!projectId) {
  console.error('Define GOOGLE_CLOUD_PROJECT_NUMBER o pasa --project <número>');
  process.exit(1);
}

const subscribers = new GoogleHealthSubscribers({ projectId });

try {
  if (command === 'list') {
    console.dir(await subscribers.list(), { depth: 6 });
  } else if (command === 'create') {
    const secret = process.env.GOOGLE_HEALTH_WEBHOOK_SECRET;
    if (!args.id || !args.url || !secret) {
      throw new Error('Necesita --id, --url y GOOGLE_HEALTH_WEBHOOK_SECRET');
    }
    const dataTypes = args.types ? String(args.types).split(',') : WEBHOOK_DATA_TYPES;
    console.dir(
      await subscribers.create({ subscriberId: args.id, endpointUri: args.url, secret, dataTypes }),
      { depth: 6 },
    );
  } else if (command === 'delete') {
    if (!args.id) throw new Error('Necesita --id');
    await subscribers.delete(args.id, { force: Boolean(args.force) });
    console.log(`✓ Suscriptor ${args.id} borrado`);
  } else {
    throw new Error(`Comando desconocido: ${command} (list | create | delete)`);
  }
} catch (error) {
  fail(error);
}
