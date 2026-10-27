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
 * @param {(userId: string) => Promise<{ extractor: Pick<import('@digitaltwin/clinical').ClinicalExtractor, 'extract'>, own?: boolean } | undefined>} deps.extractorFor
 *   El del usuario (su clave o la de la app). Sin él (no hay LLM_API_KEY ni clave propia) el
 *   documento queda en error explicándolo; si lanza (límite de IA del día), también.
 * @param {typeof processPdf} [deps.process]
 * @param {(doc: object, extraction: object) => (void|Promise<void>)} [deps.onReady]  Ya leído: para
 *   avisar de que está para revisar.
 * @param {import('pino').Logger} [deps.logger]
 */
export function createClinicalProcessor({
  store,
  extractorFor,
  process = processPdf,
  onReady,
  logger,
}) {
  return {
    /** @param {{ documentId: string }} data */
    async run({ documentId }, { last = true } = {}) {
      const doc = await store.claim(documentId);
      if (!doc) return { skipped: 'missing' };
      let ai;
      try {
        ai = await extractorFor(doc.userId);
      } catch (err) {
        await store.fail(documentId, String(err.message).slice(0, 500));
        return { failed: err.code ?? 'no-llm' };
      }
      if (!ai) {
        await store.fail(documentId, 'No hay LLM configurado (LLM_API_KEY en el worker)');
        return { failed: 'no-llm' };
      }
      try {
        const result = await process({
          data: doc.data,
          extractor: ai.extractor,
          names: await store.userNames(doc.userId),
          aliases: await store.aliases(doc.userId),
          fallbackDate: doc.requestedDate ?? null,
          context: { userId: doc.userId, own: Boolean(ai.own) },
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
        // Aviso de que está para revisar (si falla el aviso, el informe ya está leído igual)
        await Promise.resolve(onReady?.(doc, result.extraction)).catch((err) =>
          logger?.warn({ err, documentId }, 'No se pudo avisar del informe leído'),
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
