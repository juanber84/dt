// Cómo se escriben las cifras de un informe. Sin dependencias: lo usan el correo y la web.

/** Un número con sus decimales y la coma española ("1.234", "72,4"). */
export function formatNumber(value, digits = 0) {
  if (value == null || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** "72,4 kg", "2.150 / 2.300 kcal" o "sin datos". */
export function formatStat({ value, unit, digits = 0, target }) {
  const v = formatNumber(value, digits);
  if (v == null) return 'sin datos';
  const t = target != null ? ` / ${formatNumber(target, digits)}` : '';
  return `${v}${t}${unit ? ` ${unit}` : ''}`;
}
