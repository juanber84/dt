/** La noche: totales y fases (sleepFrom) y su evento del día. */
import { fmtDuration } from '../../../lib/format.js';
import { minutesFrom, sourceOf } from './common.js';

export const SLEEP_NEED = 480;
const STAGE = { light: 'light', deep: 'deep', rem: 'rem', sleep: 'light' };

/** Noche de Google → lo que esperan las vistas: totales y fases en minutos desde la medianoche de `date`. */
export function sleepFrom(date, episode) {
  if (!episode) {
    return {
      totals: {
        minutes: 0,
        deep: 0,
        rem: 0,
        light: 0,
        awake: 0,
        efficiency: 0,
        score: 0,
        need: SLEEP_NEED,
      },
      detail: { start: 0, end: 0, stages: [] },
    };
  }
  const stages = (episode.details?.stages ?? [])
    .map((s) => ({
      stage: STAGE[String(s.type).toLowerCase()] ?? 'awake',
      start: minutesFrom(date, s.startTime),
      end: minutesFrom(date, s.endTime),
    }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  // Los totales, del resumen (minutos exactos por fase, venga o no el detalle: así el día y las
  // medias de un rango dicen lo mismo); el detalle solo hace falta para dibujar las fases
  const summaryStages = Object.entries(episode.summary?.stages ?? {});
  const sum = (stage) =>
    summaryStages.length
      ? Math.round(
          summaryStages
            .filter(([type]) => (STAGE[type.toLowerCase()] ?? 'awake') === stage)
            .reduce((a, [, m]) => a + m, 0),
        )
      : stages.filter((s) => s.stage === stage).reduce((a, s) => a + s.end - s.start, 0);
  const totals = { deep: sum('deep'), rem: sum('rem'), light: sum('light'), awake: sum('awake') };
  const minutes = totals.deep + totals.rem + totals.light || (episode.summary?.asleepMinutes ?? 0);
  return {
    totals: {
      ...totals,
      minutes,
      efficiency: minutes ? Math.round((minutes / (minutes + totals.awake)) * 100) : 0,
      // Google no da puntuación: de momento, lo dormido frente a lo que necesitas
      score: Math.min(100, Math.round((minutes / SLEEP_NEED) * 100)),
      need: SLEEP_NEED,
    },
    detail: {
      start: stages[0]?.start ?? minutesFrom(date, episode.start),
      end: stages.at(-1)?.end ?? minutesFrom(date, episode.end ?? episode.start),
      stages,
    },
  };
}

export function sleepEvent(date, episode, sleep) {
  const s = sleep.totals;
  return {
    id: episode.id,
    category: 'sleep',
    icon: 'Moon',
    title: 'Sueño',
    subtitle: `${fmtDuration(s.minutes)} dormido · eficiencia ${s.efficiency}%`,
    start: sleep.detail.start,
    end: sleep.detail.end,
    metrics: [
      { label: 'Profundo', value: s.deep, unit: 'min' },
      { label: 'REM', value: s.rem, unit: 'min' },
      { label: 'Ligero', value: s.light, unit: 'min' },
      { label: 'Despierto', value: s.awake, unit: 'min' },
    ],
    sleep: { ...sleep.detail, totals: s },
    sources: [
      {
        source: sourceOf(episode),
        primary: true,
        externalId: episode.id,
        recordedAt: episode.end ?? episode.start,
        values: { type: episode.summary?.type, asleepMinutes: episode.summary?.asleepMinutes },
      },
    ],
  };
}
