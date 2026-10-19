#!/usr/bin/env node
/**
 * Vuelve a normalizar lo ya descargado (raw_records) con los normalizadores actuales: tras
 * cambiar uno, para que los datos guardados queden igual que los nuevos. No descarga nada.
 *
 *   node scripts/renormalize.js --provider google-health [--kind steps] [--from 2026-10-01]
 *
 * Al acabar borra los streams del proveedor que se han quedado vacíos. Usa DATABASE_URL.
 */
import { parseArgs } from 'node:util';
import { createDb, migrate } from '@digitaltwin/db';
import { createPipeline } from '@digitaltwin/timeline';

const { values } = parseArgs({
  options: {
    provider: { type: 'string' },
    kind: { type: 'string' },
    from: { type: 'string' },
  },
});

if (!values.provider) {
  console.error('Uso: renormalize --provider <proveedor> [--kind <tipo>] [--from YYYY-MM-DD]');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL');
  process.exit(1);
}

const db = createDb(process.env.DATABASE_URL, { max: 2 });
try {
  await migrate(db);
  const pipeline = createPipeline({ db, timeZone: process.env.TIMEZONE ?? 'Europe/Madrid' });
  const rows = await db`
    select id from raw_records
    where provider = ${values.provider}
      ${values.kind ? db`and kind = ${values.kind}` : db``}
      ${values.from ? db`and period_end > ${values.from}` : db``}
    order by period_start, id
  `;
  console.log(
    `${rows.length} registros de ${values.provider}${values.kind ? ` (${values.kind})` : ''}`,
  );
  let done = 0;
  let failed = 0;
  for (const { id } of rows) {
    try {
      await pipeline.normalize(id);
    } catch (err) {
      failed++;
      console.error(`raw ${id}: ${err.message}`);
    }
    if (++done % 200 === 0) console.log(`${done}/${rows.length}`);
  }
  const removed = await db`
    delete from streams s
    where s.provider = ${values.provider}
      and not exists (select 1 from observations o where o.stream_id = s.id)
      and not exists (select 1 from episodes e where e.stream_id = s.id)
    returning s.origin
  `;
  console.log(
    `Hecho: ${done - failed} normalizados, ${failed} con error, ${removed.length} streams vacíos borrados`,
  );
  process.exitCode = failed ? 1 : 0;
} finally {
  await db.end();
}
