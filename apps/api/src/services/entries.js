import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { JOBS, PRIORITY } from '@digitaltwin/queue';
import { DAY_MS, localMidnight } from '@digitaltwin/timeline';
import { HttpError } from '../utils/http-error.js';

const at = z.iso.datetime({ offset: true });
const text = z.string().trim().max(500);
const day = z.iso.date();

/** Tipos de periodo: fuera de casa (viaje, vacaciones), enfermo u otro. */
export const PERIOD_TYPES = Object.freeze(['away', 'sick', 'other']);
/** Más largo que esto no tiene sentido como periodo (sería otra vida, no un paréntesis). */
const MAX_PERIOD_DAYS = 90;

/** Un registro (de Registrar o del bot): un esquema por tipo, con sus límites razonables. */
export const entrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('water'), at, value: z.number().positive().max(5000) }),
  // Otra bebida (café, té, leche, zumo...): qué es, los ml que hidratan y su cafeína
  z.object({
    kind: z.literal('drink'),
    at,
    text: text.min(1).max(60),
    value: z.number().positive().max(3000),
    caffeineMg: z.number().min(0).max(1000).optional(),
  }),
  z.object({ kind: z.literal('coffee'), at, value: z.number().positive().max(1000) }),
  z.object({ kind: z.literal('weight'), at, value: z.number().min(20).max(400) }),
  z.object({
    kind: z.literal('symptom'),
    at,
    text: text.min(1),
    value: z.number().int().min(1).max(5).optional(),
  }),
  z.object({ kind: z.literal('note'), at, text: text.min(1) }),
  // Una toma: qué (text) y, si se quiere, cuánto ("1 comprimido", "2 pulverizaciones")
  z.object({
    kind: z.literal('medication'),
    at,
    text: text.min(1).max(100),
    dose: z.string().trim().max(60).optional(),
  }),
  // Una toma de un suplemento: normalmente uno de los habituales (supplementId, desde Hoy)
  z.object({
    kind: z.literal('supplement'),
    at,
    text: text.min(1).max(60),
    dose: z.string().trim().max(40).optional(),
    supplementId: z.uuid().optional(),
  }),
  // Un periodo (días locales, ambos incluidos): el motor no aprende de esos días. `at` lo pone la
  // API (la medianoche del primer día)
  z
    .object({
      kind: z.literal('period'),
      periodType: z.enum(PERIOD_TYPES),
      from: day,
      to: day,
      text: text.max(100).optional(),
    })
    .refine((p) => p.to >= p.from, { message: 'El final no puede ser antes del principio' })
    .refine((p) => (Date.parse(p.to) - Date.parse(p.from)) / DAY_MS < MAX_PERIOD_DAYS, {
      message: `Como mucho ${MAX_PERIOD_DAYS} días`,
    }),
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
 * @param {string} [deps.timeZone]  Para pasar los días de un periodo a instantes
 */
export function createEntries({ pipeline, queue, timeZone = 'Europe/Madrid' }) {
  return {
    /**
     * @param {string} userId
     * @param {{ kind: string, at: string, value?: number, text?: string }} entry
     * @param {{ channel?: 'manual'|'telegram', id?: string }} [options]  id: el del origen (el
     *   bot manda el suyo: si reintenta, no se duplica)
     */
    async add(userId, input, { channel = 'manual', id = randomUUID() } = {}) {
      // Un periodo va de la medianoche de su primer día a la del día siguiente al último
      const entry =
        input.kind === 'period'
          ? {
              ...input,
              at: localMidnight(input.from, timeZone).toISOString(),
              endAt: new Date(localMidnight(input.to, timeZone).getTime() + DAY_MS).toISOString(),
            }
          : input;
      const at = Date.parse(entry.at);
      const end = entry.endAt ? Date.parse(entry.endAt) : at + 1;
      const payload = { ...entry, id, channel, createdAt: new Date().toISOString() };
      const raw = await pipeline.ingest({
        userId,
        provider: PROVIDER,
        kind: RAW_KIND,
        externalId: id,
        periodStart: at,
        periodEnd: end,
        payload,
      });
      // Al momento (no esperar a la cola): quien lo apunta lo quiere ver ya en su día
      await pipeline.normalize(raw.id);
      return { id, ...entry };
    },

    /** Medicamentos que ya ha apuntado (para sugerirlos), del más usado al menos. */
    async medications(userId) {
      const episodes = await pipeline.queries.episodes({
        userId,
        from: new Date(Date.now() - 365 * 24 * 3600 * 1000),
        to: new Date(Date.now() + 24 * 3600 * 1000),
        kinds: ['medication'],
      });
      const count = new Map();
      for (const e of episodes) count.set(e.title, (count.get(e.title) ?? 0) + 1);
      return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
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
