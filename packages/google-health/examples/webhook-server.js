#!/usr/bin/env node
/**
 * Servidor local de webhooks para probar las notificaciones de Google Health.
 * Google necesita una URL HTTPS pública: exponlo con un túnel, p. ej.
 *   cloudflared tunnel --url http://localhost:8787      (o: ngrok http 8787)
 *
 *   GOOGLE_HEALTH_WEBHOOK_SECRET="Bearer algo-largo" node examples/webhook-server.js [--fetch]
 *
 * --fetch: por cada notificación va a por los datos con las credenciales de .local (como hará el worker).
 */
import http from 'node:http';
import { createWebhookHandler, listDataPoints, notificationToQuery } from '../src/index.js';
import { createClient, parseArgs, saveLocal } from './_shared.js';

const args = parseArgs();
const port = Number(args.port ?? 8787);
const secret = process.env.GOOGLE_HEALTH_WEBHOOK_SECRET;
if (!secret) {
  console.error(
    'Define GOOGLE_HEALTH_WEBHOOK_SECRET (el valor completo de la cabecera, p. ej. "Bearer xxx")',
  );
  process.exit(1);
}

const handle = createWebhookHandler({ secret });
const client = args.fetch ? createClient() : null;

async function processNotification(n) {
  console.log(
    `→ ${n.operation} ${n.dataType} usuario=${n.healthUserId}`,
    n.recordId ? `record=${n.recordId}` : '',
  );
  if (!client || n.operation !== 'UPSERT') return;
  const query = notificationToQuery(n);
  if (!query) return;
  const points = await listDataPoints(client, query.dataType, query);
  const path = saveLocal(`webhooks/${Date.now()}-${n.dataType}.json`, points, 0o644);
  console.log(
    `  ✓ ${points.length} puntos de ${query.from.toISOString()} a ${query.to.toISOString()} → ${path}`,
  );
}

http
  .createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const result = await handle({ headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(result.status).end();

      if (result.type === 'verification') console.log('✓ Verificación del endpoint superada');
      else if (result.type === 'rejected') console.log(`✗ Rechazada: ${result.reason}`);
      // Respondemos 204 primero y procesamos después, como pide Google
      for (const n of result.notifications) {
        processNotification(n).catch((err) =>
          console.error(`  ✗ ${err.code ?? ''} ${err.message}`),
        );
      }
    });
  })
  .listen(port, () => console.log(`Escuchando webhooks en http://localhost:${port}`));
