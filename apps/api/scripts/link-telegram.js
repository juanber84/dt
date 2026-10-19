#!/usr/bin/env node
/**
 * Vincula un usuario de Telegram con uno de Digital Twin: las comidas que mande al bot quedan a
 * su nombre. Se guarda como una conexión más (provider "telegram").
 *
 *   node scripts/link-telegram.js --email yo@ejemplo.com --telegram 123456789
 *
 * El id de Telegram te lo dice el bot si le escribes sin estar autorizado. Usa DATABASE_URL y
 * TOKEN_ENCRYPTION_KEY.
 */
import { parseArgs } from 'node:util';
import { createDb, migrate } from '@digitaltwin/db';
import { createDbConnectionStore, createSecretBox } from '@digitaltwin/connections';

const { values } = parseArgs({
  options: { email: { type: 'string' }, telegram: { type: 'string' } },
});

if (!values.email || !/^\d+$/.test(values.telegram ?? '')) {
  console.error('Uso: link-telegram --email <email> --telegram <id numérico>');
  process.exit(1);
}
for (const name of ['DATABASE_URL', 'TOKEN_ENCRYPTION_KEY']) {
  if (!process.env[name]) {
    console.error(`Falta ${name}`);
    process.exit(1);
  }
}

const db = createDb(process.env.DATABASE_URL, { max: 1 });
try {
  await migrate(db);
  const [user] = await db`select id, email from users where lower(email) = lower(${values.email})`;
  if (!user) {
    console.error(`No hay ningún usuario con el email ${values.email} (créalo con make user)`);
    process.exitCode = 1;
  } else {
    const connections = createDbConnectionStore({
      db,
      box: createSecretBox(process.env.TOKEN_ENCRYPTION_KEY),
    });
    const other = await connections.findByExternalUser('telegram', values.telegram);
    if (other && other.userId !== user.id) await connections.remove(other.userId, 'telegram');
    await connections.save({
      userId: user.id,
      provider: 'telegram',
      status: 'connected',
      account: `Telegram ${values.telegram}`,
      externalUserId: values.telegram,
    });
    console.log(`Telegram ${values.telegram} vinculado a ${user.email}`);
  }
} finally {
  await db.end();
}
