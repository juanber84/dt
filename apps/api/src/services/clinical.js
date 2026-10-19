import {
  DocumentStatus,
  buildParameters,
  extractionSchema,
  findAnalyte,
  isPdf,
  refreshExtraction,
} from '@digitaltwin/clinical';
import { JOBS, PRIORITY } from '@digitaltwin/queue';
import { clinicalPeriod } from '@digitaltwin/timeline';
import { HttpError } from '../utils/http-error.js';

export const CLINICAL = 'clinical';
// Un único kind para todos los documentos: si al revisar cambia el tipo, sigue siendo el mismo raw
const RAW_KIND = 'document';

/**
 * Informes médicos: subir el PDF (el worker lo procesa), revisar lo extraído, confirmarlo (va al
 * timeline como raw_record de 'clinical') y la evolución de cada parámetro.
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/clinical').createDbClinicalStore>} deps.store
 * @param {ReturnType<typeof import('@digitaltwin/queue').createQueue>} deps.queue
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createPipeline>} deps.pipeline
 * @param {string} deps.timeZone
 * @param {import('pino').Logger} [deps.logger]
 */
export function createClinical({ store, queue, pipeline, timeZone, logger }) {
  async function mine(userId, id) {
    const doc = await store.get(userId, id);
    if (!doc) throw HttpError.notFound('No existe ese documento');
    return doc;
  }

  async function enqueue(documentId) {
    await queue.send(JOBS.CLINICAL_EXTRACT, { documentId }, { priority: PRIORITY.LIVE });
  }

  /** Recalcula lo derivado (métricas, avisos) de lo editado y lo valida. */
  async function refreshed(userId, doc, extraction) {
    const parsed = extractionSchema.safeParse(extraction);
    if (!parsed.success) {
      throw HttpError.badRequest('El documento no tiene el formato esperado', {
        code: 'VALIDATION_ERROR',
        details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return refreshExtraction(parsed.data, doc.text ?? '', { aliases: await store.aliases(userId) });
  }

  /** Lo corregido en la revisión (no va al timeline hasta confirmar). */
  async function update(userId, id, extraction) {
    const doc = await mine(userId, id);
    const updated = await store.updateExtraction(
      userId,
      id,
      await refreshed(userId, doc, extraction),
    );
    if (!updated) throw HttpError.conflict('Ese documento aún no se puede editar');
    return updated;
  }

  return {
    list: (userId) => store.list(userId),
    get: mine,

    /**
     * Un PDF nuevo: se guarda y se encola su lectura. Si ya estaba, se devuelve el de antes.
     * @returns {Promise<{ document: object, created: boolean }>}
     */
    async upload(userId, { fileName, data, requestedDate = null }) {
      if (!data?.length || !isPdf(data)) {
        throw new HttpError(415, 'Solo se pueden subir PDFs', { code: 'NOT_A_PDF' });
      }
      const result = await store.create({ userId, fileName, data, requestedDate });
      if (result.created) await enqueue(result.document.id);
      logger?.info({ documentId: result.document.id, created: result.created }, 'informe subido');
      return result;
    },

    /** Volver a leer el PDF (tras un error, o para empezar la revisión de cero). */
    async retry(userId, id) {
      const doc = await mine(userId, id);
      if (doc.status === DocumentStatus.PROCESSING) return doc;
      if (doc.status === DocumentStatus.CONFIRMED) {
        throw HttpError.conflict('Ya está confirmado: bórralo y súbelo otra vez para releerlo');
      }
      await store.claim(id);
      await enqueue(id);
      return mine(userId, id);
    },

    update,

    /**
     * Confirma lo revisado: los nombres asignados a mano se recuerdan para la próxima analítica y
     * el documento va al timeline (episodio + observaciones).
     */
    async confirm(userId, id, extraction) {
      let doc = await mine(userId, id);
      if (extraction) doc = await update(userId, id, extraction);
      const current = doc.extraction;
      if (!current) throw HttpError.conflict('Ese documento aún no se ha leído');
      if (!current.date) {
        throw new HttpError(422, 'Falta la fecha de la prueba', { code: 'DATE_REQUIRED' });
      }

      if (current.type === 'lab') {
        const pairs = current.items
          .filter((i) => i.metric && !i.skip && findAnalyte(i.name)?.code !== i.metric)
          .map((i) => [i.name, i.metric]);
        if (pairs.length) await store.saveAliases(userId, pairs);
      }

      const confirmed = await store.confirm(userId, id);
      if (!confirmed) throw HttpError.conflict('Ese documento aún no se puede confirmar');
      const { start, end } = clinicalPeriod(current, timeZone);
      await pipeline.ingest({
        userId,
        provider: CLINICAL,
        kind: RAW_KIND,
        externalId: id,
        periodStart: start,
        periodEnd: new Date((end ?? start).getTime() + 1),
        payload: { documentId: id, fileName: doc.fileName, extraction: current },
      });
      logger?.info({ documentId: id, type: current.type }, 'informe confirmado');
      return confirmed;
    },

    /** Borra el documento y, si estaba en el timeline, lo que generó. */
    async remove(userId, id) {
      const removed = await store.remove(userId, id);
      if (!removed) throw HttpError.notFound('No existe ese documento');
      const rawId = await pipeline.store.markRawDeleted({
        userId,
        provider: CLINICAL,
        kind: RAW_KIND,
        externalId: id,
      });
      if (rawId) await queue.send(JOBS.NORMALIZE, { rawId }, { priority: PRIORITY.LIVE });
      return removed;
    },

    async parameters(userId) {
      return buildParameters(await store.confirmed(userId));
    },
  };
}
