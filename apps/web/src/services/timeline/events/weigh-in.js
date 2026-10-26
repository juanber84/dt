/** Un pesaje (báscula o a mano) como evento del día. */
import { minutesOfDay } from '../../../lib/dates.js';
import { fmtDec } from '../../../lib/format.js';
import { sourceOf } from './common.js';

export function weighInEvent(episode) {
  // Fuera el perfil de la báscula (nombre, nacimiento...): no es del pesaje
  const values = { ...episode.details };
  delete values.profile;
  delete values.user;
  const weight = episode.summary?.weight ?? values.weight;
  const bodyFat = episode.summary?.bodyFat ?? values.bodyFat;
  const metrics = [
    { label: 'Peso', value: weight, unit: 'kg', digits: 1 },
    { label: 'Grasa', value: bodyFat, unit: '%', digits: 1 },
    { label: 'Músculo', value: values.muscleMass, unit: 'kg', digits: 1 },
    { label: 'Agua', value: values.bodyWater, unit: '%', digits: 1 },
  ].filter((m) => m.value != null);
  delete values.manual;
  delete values.text;
  delete values.createdAt;
  return {
    id: episode.id,
    // Apuntado a mano: se puede borrar
    ...(episode.details?.manual && { entryId: episode.externalId }),
    category: 'body',
    icon: 'Scale',
    title: 'Pesaje',
    subtitle: `${fmtDec(weight, 1)} kg${bodyFat != null ? ` · grasa ${fmtDec(bodyFat, 1)}%` : ''}`,
    start: minutesOfDay(new Date(episode.start)),
    metrics,
    sources: [
      {
        source: sourceOf(episode),
        primary: true,
        externalId: episode.id,
        recordedAt: episode.start,
        values,
      },
    ],
  };
}
