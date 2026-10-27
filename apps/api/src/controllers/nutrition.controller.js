import { NutritionError, sumDishes } from '@digitaltwin/nutrition';
import { HttpError } from '../utils/http-error.js';
import { TELEGRAM } from '../services/telegram-link.js';

/**
 * @param {object} deps
 * @param {ReturnType<typeof import('../services/ai.js').createAi>} deps.ai
 * @param {{ findByExternalUser: Function }} [deps.connections]
 * @param {ReturnType<typeof import('../services/meals-today.js').createMealsToday>} [deps.mealsToday]
 */
export function createNutritionController({ ai, connections, mealsToday }) {
  /** De quién es: la sesión o, si llama el bot, su cuenta de Telegram vinculada. */
  async function userOf(req, telegramUserId) {
    if (req.user) return req.user.id;
    if (!req.apiClient || telegramUserId === undefined || !connections) return undefined;
    return (await connections.findByExternalUser(TELEGRAM, telegramUserId))?.userId;
  }

  /** El estimador (el suyo o el de la app) y lo que va a la cuenta del gasto. */
  async function analyzerFor(userId) {
    const { analyzer, own } = await ai.analyzer(userId);
    return { analyzer, context: userId ? { userId, own } : {} };
  }

  /** Estima alimentos, horas y macros de un texto y/o foto. */
  async function analyze(req, res) {
    const { text, image, now, telegramUserId } = req.validated.body;
    const at = now ? new Date(now) : new Date();
    const userId = await userOf(req, telegramUserId);
    const { analyzer, context } = await analyzerFor(userId);
    const earlier = mealsToday && userId ? await mealsToday({ userId, now: at }) : [];
    const result = await callLlm(() =>
      analyzer.analyze({
        text,
        image: image && { data: Buffer.from(image.base64, 'base64'), mimeType: image.mimeType },
        now: at,
        earlier,
        context,
      }),
    );
    res.json(result);
  }

  /** Rehace un análisis con la corrección del usuario. */
  async function refine(req, res) {
    const { messages, correction, telegramUserId } = req.validated.body;
    const { analyzer, context } = await analyzerFor(await userOf(req, telegramUserId));
    const result = await callLlm(() => analyzer.refine({ messages }, correction, context));
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
