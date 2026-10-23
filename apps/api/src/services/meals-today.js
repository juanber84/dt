import { localMidnight, DAY_MS } from '@digitaltwin/timeline';
import { TELEGRAM } from './telegram-link.js';

const localDate = (date, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);

/**
 * Lo que el usuario ya tiene apuntado el día de `now`: para que el LLM sepa qué comida es cada
 * plato nuevo (un yogur después de cenar es picoteo, no otra cena). El usuario sale de la sesión
 * o, si llama el bot, de su cuenta de Telegram.
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createTimelineQueries>} deps.queries
 * @param {{ findByExternalUser: Function }} deps.connections
 * @param {string} deps.timeZone
 */
export function createMealsToday({ queries, connections, timeZone }) {
  return async function mealsToday({ userId, telegramUserId, now }) {
    let id = userId;
    if (!id && telegramUserId !== undefined) {
      id = (await connections.findByExternalUser(TELEGRAM, telegramUserId))?.userId;
    }
    if (!id) return [];
    const from = localMidnight(localDate(now, timeZone), timeZone);
    const meals = await queries.episodes({
      userId: id,
      from,
      to: new Date(from.getTime() + DAY_MS),
      kinds: ['meal'],
      timeZone,
    });
    return meals.map((m) => ({
      eatenAt: m.start,
      name: m.title,
      ...(m.summary?.mealType && { mealType: m.summary.mealType }),
    }));
  };
}
