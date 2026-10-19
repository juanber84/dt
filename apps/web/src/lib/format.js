// Formato de números y tiempos en español (coma decimal, punto de miles).

const intFormat = new Intl.NumberFormat('es-ES', { useGrouping: 'always' });
const decimalFormats = new Map();

export const fmtInt = (value) => (value == null ? '—' : intFormat.format(Math.round(value)));

export function fmtDec(value, digits = 1) {
  if (value == null) return '—';
  if (!decimalFormats.has(digits)) {
    decimalFormats.set(
      digits,
      new Intl.NumberFormat('es-ES', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        useGrouping: 'always',
      }),
    );
  }
  return decimalFormats.get(digits).format(value);
}

/** Ticks de ejes: 0 · 500 · 1k · 12k */
export function fmtCompact(value) {
  if (Math.abs(value) >= 1000) {
    const k = value / 1000;
    return `${Number.isInteger(k) ? k : fmtDec(k, 1)}k`;
  }
  return fmtInt(value);
}

/** 461 → "7h 41m" · 45 → "45m" */
export function fmtDuration(minutes) {
  if (minutes == null) return '—';
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
}

/** Minutos del día → "07:45". Admite negativos (noche anterior) y > 1440. */
export function fmtClock(minutes) {
  const value = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

/** Diferencia con signo: +1,2 · −3 */
export function fmtSigned(value, digits = 0) {
  if (value == null) return '—';
  const abs = digits ? fmtDec(Math.abs(value), digits) : fmtInt(Math.abs(value));
  if (Math.abs(value) < 10 ** -digits / 2) return digits ? fmtDec(0, digits) : '0';
  return `${value > 0 ? '+' : '−'}${abs}`;
}

const rtf = new Intl.RelativeTimeFormat('es-ES', { numeric: 'auto' });

/** "hace 12 minutos" */
export function fmtRelativeTime(date, now = Date.now()) {
  const seconds = Math.round((new Date(date).getTime() - now) / 1000);
  const units = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return 'ahora mismo';
}

/** Marcas de un eje en minutos cada `stepHours` horas hasta cubrir `maxMinutes`. */
export function hourTicks(maxMinutes, stepHours = 2) {
  const step = stepHours * 60;
  const top = Math.max(step, Math.ceil(maxMinutes / step) * step);
  return Array.from({ length: top / step + 1 }, (_, i) => i * step);
}
