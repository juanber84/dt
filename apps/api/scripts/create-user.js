#!/usr/bin/env node
/**
 * Crea un usuario (o le cambia nombre, rol y contraseña si el email ya existe). Mientras no haya
 * registro, los usuarios se dan de alta así.
 *
 *   node scripts/create-user.js --email yo@ejemplo.com --name Yo --role admin
 *
 * La contraseña se pide por teclado (o USER_PASSWORD=... para scripts). Usa DATABASE_URL.
 */
import { parseArgs } from 'node:util';
import readline from 'node:readline';
import { createDb, migrate } from '@digitaltwin/db';
import { createDbUserStore } from '../src/services/users-db.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'user' },
  },
});

if (!values.email || !['admin', 'user'].includes(values.role)) {
  console.error('Uso: create-user --email <email> [--name <nombre>] [--role admin|user]');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL');
  process.exit(1);
}

const password = process.env.USER_PASSWORD || (await askHidden('Contraseña: '));
if (password.length < 6) {
  console.error('La contraseña tiene que tener al menos 6 caracteres');
  process.exit(1);
}

const db = createDb(process.env.DATABASE_URL, { max: 1 });
try {
  await migrate(db);
  const { user, created } = await createDbUserStore({ db }).upsert({ ...values, password });
  console.log(
    `${created ? 'Creado' : 'Actualizado'}: ${user.email} (${user.role}) · id ${user.id}`,
  );
} finally {
  await db.end();
}

function askHidden(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl._writeToOutput = (text) => text.startsWith(question) && rl.output.write(text);
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    }),
  );
}
