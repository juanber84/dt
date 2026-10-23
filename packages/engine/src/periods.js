/**
 * Periodos (fuera de casa, enfermo...): qué días toca cada uno y cómo se llaman. Sin
 * dependencias: lo usan el motor, el coach, los informes y la web.
 */

const DAY_MS = 24 * 3600 * 1000;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

/**
 * Días después de un periodo (viaje, enfermedad) en los que el peso aún viene con agua y sal: sus
 * pesajes cuentan menos en la tendencia y el gasto no aprende de ellos.
 */
export const SETTLING_DAYS = 3;

export const PERIOD_NAMES = Object.freeze({
  away: 'Fuera de casa',
  sick: 'Enfermo',
  other: 'Periodo',
});

/**
 * Marca cada día según los periodos que apunta la persona:
 *   away      fuera de casa: no se pesa en su báscula (lo de otra báscula no entra) ni come lo de
 *             siempre
 *   sick      enfermo: come raro y retiene agua
 *   settling  los SETTLING_DAYS después de cualquier periodo
 * @param {Array<{ date: string }>} days
 * @param {Array<{ type: 'away' | 'sick' | 'other', from: string, to: string }>} periods  días locales
 */
export function markPeriods(days, periods = []) {
  return days.map((d) => {
    const inside = periods.find((p) => d.date >= p.from && d.date <= p.to);
    if (inside) return { ...d, period: inside.type === 'away' ? 'away' : 'sick' };
    const after = periods.find((p) => d.date > p.to && daysBetween(p.to, d.date) <= SETTLING_DAYS);
    return after ? { ...d, period: 'settling' } : d;
  });
}

/**
 * El periodo que afecta a `date`: en curso ('during') o recién acabado ('settling', con los días
 * que han pasado), o null.
 */
export function currentPeriod(periods, date) {
  const during = periods.find((p) => date >= p.from && date <= p.to);
  if (during) return { ...during, phase: 'during' };
  const recent = periods
    .filter((p) => p.to < date && daysBetween(p.to, date) <= SETTLING_DAYS)
    .sort((a, b) => b.to.localeCompare(a.to))[0];
  return recent ? { ...recent, phase: 'settling', daysSince: daysBetween(recent.to, date) } : null;
}

/** "del 1/11 al 4/11" (o "el 1/11" si es un día). */
export function periodPhrase({ from, to }) {
  const dm = (date) => `${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`;
  return from === to ? `el ${dm(from)}` : `del ${dm(from)} al ${dm(to)}`;
}
