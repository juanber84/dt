import { createChatClient } from '@digitaltwin/coach';
import { NutritionAnalyzer } from '@digitaltwin/nutrition';
import { AiLimitError } from '@digitaltwin/llm-usage';
import { HttpError } from '../utils/http-error.js';

const notConfigured = () =>
  new HttpError(503, 'No hay LLM configurado (LLM_API_KEY)', { code: 'LLM_NOT_CONFIGURED' });

/**
 * El LLM de cada llamada según quién pregunta: el suyo si ha puesto clave en Cuenta → IA; si no,
 * el de la app mientras no pase su límite del día (429 AI_LIMIT).
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/llm-usage').createAiAccess>} deps.access
 * @param {ReturnType<typeof createChatClient>} [deps.coachLlm]  El de la app para el coach.
 * @param {Pick<NutritionAnalyzer, 'analyze' | 'refine'>} [deps.nutritionAnalyzer]  El de la app.
 * @param {string} deps.timeZone
 * @param {(entry: object) => unknown} deps.onUsage  Para los analizadores con la clave del usuario.
 */
export function createAi({ access, coachLlm, nutritionAnalyzer, timeZone, onUsage }) {
  /** Con su clave o la de la app; un 429 si ya ha gastado lo de hoy. */
  async function resolve(userId) {
    try {
      return await access.resolve(userId);
    } catch (err) {
      if (err instanceof AiLimitError) {
        throw new HttpError(429, err.message, {
          code: 'AI_LIMIT',
          details: { spentUsd: err.spentUsd, limitUsd: err.limitUsd },
        });
      }
      throw err;
    }
  }

  return {
    access,
    check: resolve,

    /** El LLM del coach. */
    async chat(userId) {
      const resolved = await resolve(userId);
      if (resolved.own) return { llm: createChatClient(resolved.provider), own: true };
      if (!coachLlm) throw notConfigured();
      return { llm: coachLlm, own: false };
    },

    /** El estimador de macros. Sin usuario (el bot con alguien sin vincular): el de la app. */
    async analyzer(userId) {
      const resolved = userId ? await resolve(userId) : { own: false };
      if (resolved.own) {
        return {
          analyzer: new NutritionAnalyzer({ ...resolved.provider, timeZone, onUsage }),
          own: true,
        };
      }
      if (!nutritionAnalyzer) throw notConfigured();
      return { analyzer: nutritionAnalyzer, own: false };
    },
  };
}
