import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

// Todo lo que generan los ejemplos va a packages/xiaomi/.local/ (ignorado por git)
export const LOCAL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.local');
export const CREDENTIALS_FILE = join(LOCAL_DIR, 'credentials.json');

export function saveLocal(name, content, mode = 0o600) {
  mkdirSync(LOCAL_DIR, { recursive: true });
  const path = join(LOCAL_DIR, name);
  writeFileSync(
    path,
    typeof content === 'string' || Buffer.isBuffer(content)
      ? content
      : JSON.stringify(content, null, 2),
    { mode },
  );
  return path;
}

export function loadCredentials() {
  if (!existsSync(CREDENTIALS_FILE)) {
    console.error(`No existe ${CREDENTIALS_FILE}. Ejecuta antes: make xiaomi-login`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8'));
}

export function ask(question, { hidden = false } = {}) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  if (hidden) {
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) rl.output.write(s);
    };
  }
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    }),
  );
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [key, inline] = arg.slice(2).split('=');
    args[key] = inline ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return args;
}
