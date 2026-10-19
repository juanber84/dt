#!/usr/bin/env node
/**
 * Lee datos de Google Health con las credenciales guardadas por login.js.
 *
 *   node examples/data.js                                   # todos los tipos permitidos, últimas 24 h
 *   node examples/data.js --types steps,heart-rate,sleep --from 2026-10-01 --to 2026-10-08
 *   node examples/data.js --types electrocardiogram --from 2025-11-23
 *   node examples/data.js --profile                         # identidad, perfil, ajustes y dispositivos
 *   node examples/data.js --list                            # catálogo de tipos
 *
 * Los datos crudos se guardan en .local/data/<tipo>.json
 */
import { DATA_TYPES, dataTypesForScopes, getAllData, toRecord } from '../src/index.js';
import { createClient, parseArgs, saveLocal, fail, LOCAL_DIR } from './_shared.js';

const args = parseArgs();

function summarize(type, points) {
  const records = points.map((p) => toRecord(type, p));
  const first = records[0];
  const last = records.at(-1);
  const when = (r) => r?.start ?? r?.date ?? '?';
  return { type, count: records.length, first: when(first), last: when(last) };
}

try {
  if (args.list) {
    console.table(
      DATA_TYPES.map(({ id, kind, scope, webhook }) => ({
        id,
        kind,
        scope: scope.split('.').at(-2),
        webhook,
      })),
    );
    process.exit(0);
  }

  const client = createClient();

  if (args.profile) {
    for (const [name, fn] of [
      ['identity', () => client.getIdentity()],
      ['profile', () => client.getProfile()],
      ['settings', () => client.getSettings()],
      ['pairedDevices', () => client.listPairedDevices()],
    ]) {
      try {
        const value = await fn();
        console.log(`\n== ${name}`);
        console.dir(value, { depth: 6 });
        saveLocal(`data/${name}.json`, value, 0o644);
      } catch (error) {
        console.log(`\n== ${name}: ${error.code} ${error.message}`);
      }
    }
    process.exit(0);
  }

  const to = args.to ? new Date(args.to) : new Date();
  const from = args.from ? new Date(args.from) : new Date(to.getTime() - 24 * 3600_000);
  const types = args.types
    ? String(args.types).split(',')
    : dataTypesForScopes(client.credentials.scope ?? '').map((d) => d.id);

  console.log(`Desde ${from.toISOString()} hasta ${to.toISOString()} · ${types.length} tipos\n`);
  const { data, errors } = await getAllData(client, { types, from, to, timeZone: args.tz });

  for (const [type, points] of Object.entries(data)) saveLocal(`data/${type}.json`, points, 0o644);

  console.table(Object.entries(data).map(([type, points]) => summarize(type, points)));
  if (Object.keys(errors).length) {
    console.log('\nTipos con error:');
    console.table(
      Object.entries(errors).map(([type, e]) => ({
        type,
        code: e.code,
        message: e.message.slice(0, 90),
      })),
    );
  }
  console.log(`\nDatos crudos en ${LOCAL_DIR}/data/`);
} catch (error) {
  fail(error);
}
