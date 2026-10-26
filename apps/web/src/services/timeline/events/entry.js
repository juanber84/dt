/** Lo apuntado a mano (Registrar o el bot) como evento del día. */
import { minutesOfDay } from '../../../lib/dates.js';
import { fmtInt } from '../../../lib/format.js';
import { sourceOf } from './common.js';

/** "Del 1 al 4 de noviembre" / "Solo el 1 de noviembre" (sin año: es de días cercanos). */
export function periodRange({ from, to }) {
  if (!from || !to) return '';
  const fmt = (d, opts) =>
    new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', ...opts }).format(
      new Date(`${d}T12:00:00Z`),
    );
  if (from === to) return `Solo el ${fmt(from, { day: 'numeric', month: 'long' })}`;
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return `Del ${fmt(from, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'long' })} al ${fmt(to, { day: 'numeric', month: 'long' })}`;
}

/**
 * Lo apuntado a mano (agua, café, síntoma, nota): `entryId` deja borrarlo desde el lateral.
 */
export function entryEvent(episode) {
  const s = episode.summary ?? {};
  const base = {
    id: episode.id,
    entryId: episode.externalId,
    start: minutesOfDay(new Date(episode.start)),
    sources: [
      {
        source: sourceOf(episode),
        primary: true,
        externalId: episode.externalId ?? episode.id,
        recordedAt: episode.details?.createdAt ?? episode.start,
        values: episode.details?.text ? { texto: episode.details.text } : {},
      },
    ],
  };
  if (episode.kind === 'drink' && s.waterMl != null) {
    return {
      ...base,
      category: 'hydration',
      icon: 'Droplets',
      title: 'Agua',
      subtitle: `${fmtInt(s.waterMl)} ml`,
      metrics: [{ label: 'Agua', value: s.waterMl, unit: 'ml' }],
    };
  }
  // Otra bebida (Registrar → Bebida): su nombre, lo que hidrata y la cafeína si tiene
  if (episode.kind === 'drink' && s.fluidMl != null) {
    return {
      ...base,
      category: 'hydration',
      icon: s.caffeineMg ? 'Coffee' : 'CupSoda',
      title: episode.title,
      subtitle: [`${fmtInt(s.fluidMl)} ml`, s.caffeineMg && `${fmtInt(s.caffeineMg)} mg de cafeína`]
        .filter(Boolean)
        .join(' · '),
      metrics: [
        { label: 'Líquido', value: s.fluidMl, unit: 'ml' },
        { label: 'Cafeína', value: s.caffeineMg ?? null, unit: 'mg' },
      ].filter((m) => m.value != null),
    };
  }
  if (episode.kind === 'drink') {
    return {
      ...base,
      category: 'hydration',
      icon: 'Coffee',
      title: 'Café',
      subtitle: `${fmtInt(s.caffeineMg)} mg de cafeína`,
      metrics: [{ label: 'Cafeína', value: s.caffeineMg, unit: 'mg' }],
    };
  }
  if (episode.kind === 'medication') {
    return {
      ...base,
      category: 'clinical',
      icon: 'Pill',
      title: episode.title,
      subtitle: s.dose ? `Medicación · ${s.dose}` : 'Medicación',
      metrics: [],
    };
  }
  // Una toma de un suplemento (los chips de Hoy): `supplementId` dice cuál de los habituales es
  if (episode.kind === 'supplement') {
    return {
      ...base,
      category: 'nutrition',
      icon: 'PillBottle',
      title: episode.title,
      subtitle: s.dose ? `Suplemento · ${s.dose}` : 'Suplemento',
      metrics: [],
      supplementId: s.supplementId ?? null,
    };
  }
  // Un periodo (fuera de casa, enfermo): sale el día que empieza, con hasta cuándo
  if (episode.kind === 'period') {
    return {
      ...base,
      category: 'note',
      icon: s.type === 'away' ? 'Luggage' : s.type === 'sick' ? 'Thermometer' : 'CalendarRange',
      title: episode.title,
      subtitle: periodRange(s),
      metrics: [],
    };
  }
  if (episode.kind === 'symptom') {
    return {
      ...base,
      category: 'note',
      icon: 'Stethoscope',
      title: episode.title,
      subtitle: s.intensity ? `Síntoma · intensidad ${s.intensity}/5` : 'Síntoma',
      metrics: s.intensity ? [{ label: 'Intensidad', value: s.intensity, unit: '/ 5' }] : [],
    };
  }
  return {
    ...base,
    category: 'note',
    icon: 'NotebookPen',
    title: 'Nota',
    subtitle: episode.title,
    metrics: [],
  };
}
