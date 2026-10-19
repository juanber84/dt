import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleHealthAuth, GoogleHealthClient } from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// Todo lo que generan los ejemplos va a packages/google-health/.local/ (ignorado por git)
export const LOCAL_DIR = join(HERE, '..', '.local');
export const CREDENTIALS_FILE = join(LOCAL_DIR, 'credentials.json');
// Por defecto el client_secret.json de la raíz del repo (el de los scripts originales)
export const CLIENT_SECRET_FILE = resolve(
  process.env.GOOGLE_CLIENT_SECRET_FILE ?? join(HERE, '..', '..', '..', '..', 'client_secret.json'),
);
export const REDIRECT_PORT = Number(process.env.GOOGLE_REDIRECT_PORT ?? 3000);
export const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

export const logger = process.env.DEBUG
  ? {
      debug: (obj, msg) => console.log('[DEBUG]', msg, obj),
      error: (obj, msg) => console.error(msg, obj),
    }
  : undefined;

export function saveLocal(name, content, mode = 0o600) {
  const path = join(LOCAL_DIR, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2), {
    mode,
  });
  return path;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadClientSecret() {
  if (!existsSync(CLIENT_SECRET_FILE)) {
    console.error(
      `No existe ${CLIENT_SECRET_FILE}. Usa GOOGLE_CLIENT_SECRET_FILE=/ruta/client_secret.json`,
    );
    process.exit(1);
  }
  const json = readJson(CLIENT_SECRET_FILE);
  return json.web ?? json.installed;
}

export function createAuth() {
  return GoogleHealthAuth.fromClientSecretJson(readJson(CLIENT_SECRET_FILE), REDIRECT_URI);
}

/** Cliente con las credenciales de .local; en el proyecto real vendrían de BD. */
export function createClient() {
  if (!existsSync(CREDENTIALS_FILE)) {
    console.error(`No existe ${CREDENTIALS_FILE}. Ejecuta antes: make google-login`);
    process.exit(1);
  }
  const cfg = loadClientSecret();
  return new GoogleHealthClient({
    credentials: readJson(CREDENTIALS_FILE),
    clientId: cfg.client_id,
    clientSecret: cfg.client_secret,
    logger,
    onCredentialsRefreshed: (credentials) => {
      saveLocal('credentials.json', credentials);
      if (logger) console.log('✓ Access token renovado y guardado');
    },
  });
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      args._.push(arg);
      continue;
    }
    const [key, inline] = arg.slice(2).split('=');
    args[key] = inline ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return args;
}

export function fail(error) {
  console.error(`\nERROR${error.code ? ` [${error.code}]` : ''}: ${error.message}`);
  if (error.details) console.error(error.details);
  if (process.env.DEBUG) console.error(error.stack);
  process.exit(1);
}
