#!/usr/bin/env node
/**
 * Conecta tu cuenta de Google (OAuth) igual que lo hará el front + API:
 * abre la URL de consentimiento, recibe el callback en localhost y guarda las credenciales.
 *
 *   node examples/login.js
 *   node examples/login.js --import ../../../tokens.json   # reutiliza el tokens.json de los scripts viejos
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { dataTypesForScopes, GoogleHealthClient } from '../src/index.js';
import {
  createAuth,
  loadClientSecret,
  readJson,
  saveLocal,
  parseArgs,
  fail,
  REDIRECT_PORT,
  CREDENTIALS_FILE,
  logger,
} from './_shared.js';

const args = parseArgs();

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  execFile(cmd, [url], () => {});
}

async function oauthFlow() {
  const auth = createAuth();
  const state = crypto.randomBytes(16).toString('hex');
  const url = auth.getAuthUrl({ state });

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
      if (reqUrl.pathname !== '/oauth2callback') {
        res.writeHead(404).end();
        return;
      }
      const error = reqUrl.searchParams.get('error');
      if (error || reqUrl.searchParams.get('state') !== state) {
        res.end('Error en la autorización. Puedes cerrar esta ventana.');
        server.close();
        reject(new Error(error ?? 'El parámetro state no coincide'));
        return;
      }
      res.end('Cuenta conectada. Puedes cerrar esta ventana.');
      server.close();
      resolve(reqUrl.searchParams.get('code'));
    });
    server.listen(REDIRECT_PORT, () => {
      console.log('Abriendo el navegador para autorizar. Si no se abre, entra en:\n');
      console.log(url, '\n');
      openBrowser(url);
    });
  });

  return auth.exchangeCode(code);
}

async function importTokens(path) {
  const tokens = readJson(path);
  const cfg = loadClientSecret();
  const client = new GoogleHealthClient({
    credentials: tokens,
    clientId: cfg.client_id,
    clientSecret: cfg.client_secret,
    logger,
  });
  const identity = await client.getIdentity();
  return { ...client.credentials, healthUserId: identity.healthUserId };
}

try {
  const credentials = args.import ? await importTokens(args.import) : await oauthFlow();
  saveLocal('credentials.json', credentials);

  const types = dataTypesForScopes(credentials.scope ?? '');
  console.log(`✓ Conectado (healthUserId ${credentials.healthUserId})`);
  console.log(`✓ Credenciales guardadas en ${CREDENTIALS_FILE}`);
  console.log(`✓ Tipos de datos legibles con los permisos concedidos: ${types.length}`);
  if (!credentials.refresh_token) {
    console.log(
      '! Google no devolvió refresh_token: cuando caduque el access token habrá que reconectar.',
    );
  }
  if (credentials.refresh_token_expires_in) {
    const days = Math.round(credentials.refresh_token_expires_in / 86400);
    console.log(`! El refresh token caduca en ${days} días: la app OAuth está en modo "Testing".`);
  }
} catch (error) {
  fail(error);
}
