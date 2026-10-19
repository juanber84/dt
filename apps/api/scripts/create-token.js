#!/usr/bin/env node
/**
 * Crea un token personal para conectar un cliente de IA (Claude Code, Claude Desktop...) al MCP
 * (/api/mcp). El token sale por pantalla una sola vez.
 *
 *   node scripts/create-token.js --email yo@ejemplo.com --name "Claude Code portátil"
 *
 * Usa DATABASE_URL.
 */
import { parseArgs } from 'node:util';
import { createDb, migrate } from '@digitaltwin/db';
import { createDbPersonalTokens } from '../src/services/personal-tokens.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string', default: 'MCP' },
  },
});

if (!values.email) {
  console.error('Uso: create-token --email <email> [--name <para qué es>]');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL');
  process.exit(1);
}

const db = createDb(process.env.DATABASE_URL, { max: 1 });
try {
  await migrate(db);
  const [user] = await db`select id from users where lower(email) = lower(${values.email.trim()})`;
  if (!user) {
    console.error(`No existe el usuario ${values.email}`);
    process.exitCode = 1;
  } else {
    const { token, name } = await createDbPersonalTokens({ db }).create({
      userId: user.id,
      name: values.name,
    });
    console.log(
      `Token "${name}" para ${values.email} (guárdalo, no se vuelve a enseñar):\n${token}`,
    );
  }
} finally {
  await db.end();
}
