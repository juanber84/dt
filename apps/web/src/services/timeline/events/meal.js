/** Una comida como evento del día. */
import { minutesOfDay } from '../../../lib/dates.js';
import { fmtDec, fmtInt } from '../../../lib/format.js';
import { MEAL_TYPE_LABELS } from '@digitaltwin/nutrition/meal-types';
import { round1, sourceOf } from './common.js';

export { MEAL_TYPE_LABELS };

export function mealEvent(episode) {
  const s = episode.summary ?? {};
  const macros = {
    kcal: Math.round(s.kcal ?? 0),
    protein: round1(s.proteinG),
    carbs: round1(s.carbsG),
    fat: round1(s.fatG),
  };
  const items = episode.details?.items ?? [];
  return {
    id: episode.id,
    category: 'nutrition',
    icon: 'Utensils',
    title: episode.title,
    subtitle: [
      MEAL_TYPE_LABELS[s.mealType],
      `${fmtInt(macros.kcal)} kcal · ${fmtDec(macros.protein, 1)} g proteína`,
    ]
      .filter(Boolean)
      .join(' · '),
    mealType: s.mealType ?? null,
    start: minutesOfDay(new Date(episode.start)),
    metrics: [
      { label: 'Calorías', value: macros.kcal, unit: 'kcal' },
      { label: 'Proteína', value: macros.protein, unit: 'g', digits: 1 },
      { label: 'Hidratos', value: macros.carbs, unit: 'g', digits: 1 },
      { label: 'Grasa', value: macros.fat, unit: 'g', digits: 1 },
    ],
    macros,
    sources: [
      {
        source: sourceOf(episode),
        primary: true,
        externalId: episode.details?.entryId ?? episode.id,
        recordedAt: episode.details?.createdAt ?? episode.start,
        values: {
          text: episode.details?.text ?? '',
          alimentos: items.map((i) => `${i.name} (${Math.round(i.kcal)} kcal)`).join(' · '),
          ...(episode.details?.notes && { notas: episode.details.notes }),
        },
      },
    ],
  };
}
