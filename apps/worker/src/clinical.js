import { ClinicalError, ClinicalErrorCode, processPdf } from '@digitaltwin/clinical';

// Reintentar no arregla un PDF sin texto o que no es un PDF
const PERMANENT = new Set([
  ClinicalErrorCode.INVALID_PDF,
  ClinicalErrorCode.NO_TEXT,
  ClinicalErrorCode.PDF_TOOL_MISSING,
]);

/**
 * Lee los informes que suben los usuarios: PDF → texto sin datos personales → LLM → documento
 * para revisar. Si falla en el último intento (o el fallo no tiene arreglo) queda en 'error' con
 * el motivo, para que se vea en la app y se pueda reintentar.
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/clinical').createDbClinicalStore>} deps.store
 * @param {Pick<import('@digitaltwin/clinical').ClinicalExtractor, 'extract'> | undefined} deps.extractor
 *   Sin él (no hay LLM_API_KEY) los documentos quedan en error explicándolo.
 * @param {typeof processPdf} [deps.process]
 * @param {import('pino').Logger} [deps.logger]
 */
export function createClinicalProcessor({ store, extractor, process = processPdf, logger }) {
  return {
    /** @param {{ documentId: string }} data */
    async run({ documentId }, { last = true } = {}) {
      const doc = await store.claim(documentId);
      if (!doc) return { skipped: 'missing' };
      if (!extractor) {
        await store.fail(documentId, 'No hay LLM configurado (LLM_API_KEY en el worker)');
        return { failed: 'no-llm' };
      }
      try {
        const result = await process({
          data: doc.data,
          extractor,
          names: await store.userNames(doc.userId),
          aliases: await store.aliases(doc.userId),
          fallbackDate: doc.requestedDate ?? null,
          context: { userId: doc.userId },
        });
        await store.saveExtraction(documentId, result);
        logger?.info(
          {
            documentId,
            type: result.extraction.type,
            items: result.extraction.items.length,
            redactions: result.redactions,
          },
          'informe leído',
        );
        return { type: result.extraction.type, items: result.extraction.items.length };
      } catch (err) {
        const permanent = err instanceof ClinicalError && PERMANENT.has(err.code);
        if (permanent || last) {
          await store.fail(documentId, String(err.message).slice(0, 500));
          return { failed: err.code ?? 'error' };
        }
        throw err;
      }
    },
  };
}
