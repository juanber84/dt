/**
 * Lo que enseña Hoy, calculado a partir del día y de su historia (los 30 días anteriores). Son
 * funciones puras: la vista y las tarjetas solo pintan lo que sale de aquí.
 */
import { fmtDec, fmtDuration, fmtInt, fmtSigned } from '../lib/format.js';

/** Recuperación → tono, texto y color del anillo. */
export function recoveryOf(day) {
  const v = day?.recovery;
  if (v == null) return { tone: 'neutral', label: 'Sin calcular', color: 'var(--grid)' };
  if (v >= 67) return { tone: 'good', label: 'Alta', color: 'var(--good)' };
  if (v >= 34) return { tone: 'warning', label: 'Media', color: 'var(--warning)' };
  return { tone: 'critical', label: 'Baja', color: 'var(--critical)' };
}

const average = (values) => {
  const list = values.filter((v) => v != null);
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
};

/** La frase de debajo de los anillos: VFC frente a tu media, reposo, sueño que faltó y consejo. */
export function insightOf(day, history = []) {
  if (!day) return '';
  const hrvAvg = average(history.map((s) => s.hrv)) ?? day.hrv;
  const hrvPct = Math.round(((day.hrv - hrvAvg) / hrvAvg) * 100);
  const parts = [];
  if (day.hrv != null)
    parts.push(
      hrvPct === 0
        ? `VFC de ${day.hrv} ms, en tu media`
        : `VFC de ${day.hrv} ms, un ${Math.abs(hrvPct)} % por ${hrvPct > 0 ? 'encima' : 'debajo'} de tu media`,
    );
  if (day.rhr != null) parts.push(`FC en reposo de ${day.rhr} ppm`);
  const sleepGap = day.sleep.need - day.sleep.minutes;
  if (day.sleep.minutes && sleepGap > 30)
    parts.push(`te faltaron ${fmtDuration(sleepGap)} de sueño`);
  if (!parts.length) parts.push('Sin datos del reloj este día');
  // El consejo sale de la recuperación: sin ella, solo los datos
  const advice =
    day.recovery == null
      ? ''
      : day.recovery >= 67
        ? ' Buen día para meter intensidad.'
        : day.recovery >= 34
          ? ' Mejor volumen suave que series.'
          : ' Hoy toca descanso o algo muy suave.';
  return `${parts.join(', ')}.${advice}`;
}

/** Las seis constantes con su diferencia frente a la media de 30 días y su tendencia. */
export function vitalsOf(day, history = []) {
  if (!day) return [];
  const series = (key) => history.map((s) => s[key]);
  // Sin dato ese día (o sin historia con la que comparar) no hay comparación
  const vs = (key) => {
    const avg = average(series(key));
    return day[key] == null || avg == null ? null : day[key] - avg;
  };
  return [
    {
      label: 'VFC',
      value: fmtInt(day.hrv),
      unit: 'ms',
      delta: vs('hrv'),
      goodWhen: 'up',
      trend: series('hrv'),
    },
    {
      label: 'FC en reposo',
      value: fmtInt(day.rhr),
      unit: 'ppm',
      delta: vs('rhr'),
      goodWhen: 'down',
      trend: series('rhr'),
    },
    {
      label: 'SpO2',
      value: fmtDec(day.spo2, 1),
      unit: '%',
      delta: vs('spo2'),
      deltaDigits: 1,
      goodWhen: 'up',
      trend: series('spo2'),
    },
    {
      label: 'Frec. respiratoria',
      value: fmtDec(day.respRate, 1),
      unit: 'rpm',
      delta: vs('respRate'),
      deltaDigits: 1,
      goodWhen: 'none',
      trend: series('respRate'),
    },
    {
      label: 'Temp. de la piel',
      value: fmtSigned(day.skinTemp, 1),
      unit: '°C',
      delta: null,
      goodWhen: 'none',
      trend: series('skinTemp'),
    },
    // Forma cardiovascular (la estima el reloj): va con las constantes, no con la báscula
    {
      label: 'VO2 máx.',
      value: fmtDec(day.vo2max, 1),
      unit: 'mL/kg/min',
      delta: vs('vo2max'),
      deltaDigits: 1,
      goodWhen: 'up',
      trend: series('vo2max'),
    },
  ];
}

/** El último pesaje de los 30 días, cuánto ha cambiado y la serie del peso; null si no hay. */
export function bodyOf(history = [], date) {
  const weighed = history.filter((s) => s.weight != null);
  const latest = weighed.at(-1);
  if (!latest) return null;
  return {
    ...latest,
    isToday: latest.date === date,
    delta: latest.weight - weighed[0].weight,
    trend: history.map((s) => s.weight),
  };
}

/** ml → "1,4" (litros con un decimal); sin dato, "—". */
export const liters = (ml) => (ml == null ? '—' : fmtDec(ml / 1000, 1));
