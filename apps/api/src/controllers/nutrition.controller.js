import { NutritionError, sumDishes } from '@digitaltwin/nutrition';
import { HttpError } from '../utils/http-error.js';

/**
 * @param {object} deps
 * @param {Pick<import('@digitaltwin/nutrition').NutritionAnalyzer, 'analyze' | 'refine'>} [deps.analyzer]
 * @param {ReturnType<typeof import('../services/meals-today.js').createMealsToday>} [deps.mealsToday]
 */
export function createNutritionController({ analyzer, mealsToday }) {
  function requireAnalyzer() {
    if (!analyzer) {
      throw new HttpError(503, 'No hay LLM configurado (LLM_API_KEY)', {
        code: 'LLM_NOT_CONFIGURED',
      });
    }
    return analyzer;
  }

  /** Estima alimentos, horas y macros de un texto y/o foto. */
  async function analyze(req, res) {
    const { text, image, now, telegramUserId } = req.validated.body;
    const at = now ? new Date(now) : new Date();
    const llm = requireAnalyzer();
    // El bot solo puede hablar por usuarios de Telegram; la web, por quien tiene la sesión
    const earlier = mealsToday
      ? await mealsToday({
          userId: req.user?.id,
          telegramUserId: req.apiClient ? telegramUserId : undefined,
          now: at,
        })
      : [];
    const result = await callLlm(() =>
      llm.analyze({
        text,
        image: image && { data: Buffer.from(image.base64, 'base64'), mimeType: image.mimeType },
        now: at,
        earlier,
      }),
    );
    res.json(result);
  }

  /** Rehace un análisis con la corrección del usuario. */
  async function refine(req, res) {
    const { messages, correction } = req.validated.body;
    const result = await callLlm(() => requireAnalyzer().refine({ messages }, correction));
    res.json(result);
  }

  /** De momento solo se registra en el log; cuando haya base de datos se guardará aquí. */
  function createEntry(req, res) {
    const entry = req.validated.body;
    const total = sumDishes(entry.dishes);

    req.log.info({ entry, total }, 'nutrition entrada recibida');

    res.status(201).json({ id: entry.id, dishes: entry.dishes.length, total });
  }

  return { analyze, refine, createEntry };
}

async function callLlm(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof NutritionError) {
      throw new HttpError(502, `LLM: ${error.message}`, { code: `LLM_${error.code}` });
    }
    throw error;
  }
}
