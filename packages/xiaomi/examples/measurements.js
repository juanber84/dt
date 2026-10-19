#!/usr/bin/env node
/**
 * Descarga mediciones de la báscula con las credenciales guardadas por login.js.
 * Simula el proceso periódico: si la sesión ha caducado intenta renovarla con passToken.
 *
 *   node examples/measurements.js                          # todo el histórico
 *   node examples/measurements.js --from 2026-09-01        # desde una fecha
 *   node examples/measurements.js --from 2026-09-01 --to 2026-09-30 --region de
 *   node examples/measurements.js --model yunmai.scales.ms104
 *   node examples/measurements.js --last 20                # muestra las 20 últimas
 *   node examples/measurements.js --devices                # lista básculas de la cuenta
 *   node examples/measurements.js --refresh                # fuerza renovar la sesión
 */
import {
  XiaomiCloudClient,
  XiaomiError,
  getScaleMeasurements,
  getScales,
  DEFAULT_SCALE_MODEL,
  SCALE_METRICS,
} from '../src/index.js';
import { loadCredentials, parseArgs, saveLocal } from './_shared.js';

const args = parseArgs();
const region = args.region ?? 'de';
const model = args.model ?? DEFAULT_SCALE_MODEL;
const logger = process.env.DEBUG
  ? { debug: (obj, msg) => console.log('[DEBUG]', msg, obj) }
  : undefined;

// En el proyecto real: credenciales leídas de BD y el callback las vuelve a guardar en BD.
const client = new XiaomiCloudClient({
  credentials: loadCredentials(),
  region,
  logger,
  onCredentialsRefreshed: (credentials) => {
    saveLocal('credentials.json', credentials);
    console.log('✓ Sesión caducada: renovada con passToken y guardada');
  },
});

function printMeasurement(m) {
  console.log('--------------------------------');
  console.log(`Fecha:  ${m.date}`);
  if (m.user) console.log(`Usuario: ${m.user}`);
  for (const { key, label, unit } of SCALE_METRICS) {
    if (m[key] === null) continue;
    console.log(`  ${label.padEnd(28)} ${m[key]}${unit ? ` ${unit}` : ''}`);
  }
  if (m.source) console.log(`  ${'Fuente'.padEnd(28)} ${m.source}`);
}

async function run() {
  if (args.devices) {
    const scales = await getScales(client);
    console.log(
      scales.length
        ? scales.map((d) => `${d.name} | ${d.model} | ${d.did}`).join('\n')
        : 'Sin básculas en esta región',
    );
    return;
  }

  console.log(
    `Región ${region} · modelo ${model} · desde ${args.from ?? 'el principio'} · hasta ${args.to ?? 'ahora'}`,
  );
  const measurements = await getScaleMeasurements(client, { from: args.from, to: args.to, model });
  const path = saveLocal('measurements.json', measurements, 0o644);

  console.log(`\n✓ ${measurements.length} mediciones (guardadas en ${path})\n`);
  const last = Number(args.last ?? 5);
  for (const m of measurements.slice(-last).reverse()) printMeasurement(m);
}

try {
  if (args.refresh) await client.refreshCredentials();
  await run();
} catch (error) {
  console.error(
    `\nERROR${error instanceof XiaomiError ? ` [${error.code}]` : ''}: ${error.message}`,
  );
  if (error.details) console.error(error.details);
  if (process.env.DEBUG) console.error(error.stack);
  process.exit(1);
}
