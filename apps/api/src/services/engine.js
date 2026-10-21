import { addDays, computeState } from '@digitaltwin/engine';

const HISTORY_DAYS = 70;
const METRICS = ['intake.energy', 'body.weight', 'body.fat_percent', 'activity.steps'];

const localDate = (date, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);

/**
 * El motor para un usuario: junta sus días (lo comido, el peso, la grasa, los pasos y cuántos
 * platos apuntó) y calcula su estado (@digitaltwin/engine). Se calcula al pedirlo: son unas pocas
 * consultas y así siempre va al día.
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createTimelineQueries>} deps.queries
 * @param {ReturnType<typeof import('./profile.js').createProfiles>} deps.profiles
 * @param {string} deps.timeZone
 */
export function createEngine({ queries, profiles, timeZone, now = () => new Date() }) {
  return {
    async state(userId) {
      const today = localDate(now(), timeZone);
      const first = addDays(today, -HISTORY_DAYS + 1);
      const from = new Date(`${first}T00:00:00Z`);
      const to = new Date(Date.parse(`${today}T00:00:00Z`) + 2 * 24 * 3600 * 1000);
      const [profile, series, meals] = await Promise.all([
        profiles.get(userId),
        queries.series({ userId, from, to, bucket: 'day', metrics: METRICS, timeZone }),
        queries.episodes({ userId, from, to, kinds: ['meal'], timeZone }),
      ]);

      const days = new Map();
      for (let i = 0; i < HISTORY_DAYS; i++)
        days.set(addDays(first, i), { date: addDays(first, i) });
      const put = (metric, key) => {
        for (const p of series[metric]?.points ?? []) {
          const day = days.get(localDate(new Date(p.t), timeZone));
          if (day) day[key] = p.value;
        }
      };
      put('intake.energy', 'kcal');
      put('body.weight', 'weight');
      put('body.fat_percent', 'bodyFat');
      put('activity.steps', 'steps');
      for (const m of meals) {
        const day = days.get(localDate(new Date(m.start), timeZone));
        if (day) day.dishes = (day.dishes ?? 0) + 1;
      }

      return computeState({ profile, days: [...days.values()], today });
    },
  };
}
