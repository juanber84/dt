import { localMidnight, DAY_MS } from '@digitaltwin/timeline';

const localDate = (date, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);

/**
 * Lo que el usuario ya tiene apuntado el día de `now`: para que el LLM sepa qué comida es cada
 * plato nuevo (un yogur después de cenar es picoteo, no otra cena).
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createTimelineQueries>} deps.queries
 * @param {string} deps.timeZone
 */
export function createMealsToday({ queries, timeZone }) {
  return async function mealsToday({ userId, now }) {
    const from = localMidnight(localDate(now, timeZone), timeZone);
    const meals = await queries.episodes({
      userId,
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
