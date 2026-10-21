import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { JOBS, PRIORITY } from '@digitaltwin/queue';
import { HttpError } from '../utils/http-error.js';

const at = z.iso.datetime({ offset: true });
const text = z.string().trim().max(500);

/** Un registro (de Registrar o del bot): un esquema por tipo, con sus límites razonables. */
export const entrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('water'), at, value: z.number().positive().max(5000) }),
  z.object({ kind: z.literal('coffee'), at, value: z.number().positive().max(1000) }),
  z.object({ kind: z.literal('weight'), at, value: z.number().min(20).max(400) }),
  z.object({
    kind: z.literal('symptom'),
    at,
    text: text.min(1),
    value: z.number().int().min(1).max(5).optional(),
  }),
  z.object({ kind: z.literal('note'), at, text: text.min(1) }),
]);

const PROVIDER = 'digitaltwin';
const RAW_KIND = 'entry';

/**
 * Registros sueltos (agua, café, peso, síntomas, notas): de Registrar en la app o del bot. Entran
 * por el pipeline como las comidas del bot (raw_record → timeline), cada uno del usuario que lo
 * apunta.
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createPipeline>} deps.pipeline
 * @param {ReturnType<typeof import('@digitaltwin/queue').createQueue>} deps.queue
 */
export function createEntries({ pipeline, queue }) {
  return {
    /**
     * @param {string} userId
     * @param {{ kind: string, at: string, value?: number, text?: string }} entry
     * @param {{ channel?: 'manual'|'telegram', id?: string }} [options]  id: el del origen (el
     *   bot manda el suyo: si reintenta, no se duplica)
     */
    async add(userId, entry, { channel = 'manual', id = randomUUID() } = {}) {
      const at = Date.parse(entry.at);
      const payload = { ...entry, id, channel, createdAt: new Date().toISOString() };
      const raw = await pipeline.ingest({
        userId,
        provider: PROVIDER,
        kind: RAW_KIND,
        externalId: id,
        periodStart: at,
        periodEnd: at + 1,
        payload,
      });
      // Al momento (no esperar a la cola): quien lo apunta lo quiere ver ya en su día
      await pipeline.normalize(raw.id);
      return { id, ...entry };
    },

    /** Borra un registro suyo (y lo que generó en el timeline). */
    async remove(userId, id) {
      const rawId = await pipeline.store.markRawDeleted({
        userId,
        provider: PROVIDER,
        kind: RAW_KIND,
        externalId: id,
      });
      if (!rawId) throw HttpError.notFound('No existe ese registro');
      await pipeline.normalize(rawId);
      // Por si había uno en cola con el registro antiguo
      await queue.send(JOBS.NORMALIZE, { rawId }, { priority: PRIORITY.LIVE });
    },
  };
}
