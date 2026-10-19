/** Desfase (ms) de `timeZone` respecto a UTC en el instante `ms`. */
function offsetMs(ms, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, Number(p.value)]),
  );
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Medianoche local de `date` (YYYY-MM-DD) en `timeZone`, como Date. */
export function localMidnight(date, timeZone) {
  const [year, month, day] = date.split('-').map(Number);
  const guess = Date.UTC(year, month - 1, day);
  let ms = guess - offsetMs(guess, timeZone);
  // Si entre medias hay cambio de hora, el desfase bueno es el del resultado
  ms = guess - offsetMs(ms, timeZone);
  return new Date(ms);
}

/** Inicio del día UTC de `value`. */
export function utcDay(value) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export const DAY_MS = 24 * 3600 * 1000;

/** Días UTC [from, to) como pares { from, to } (de más reciente a más antiguo si `newestFirst`). */
export function splitDays(from, to, { newestFirst = false } = {}) {
  const days = [];
  for (let t = utcDay(from).getTime(); t < new Date(to).getTime(); t += DAY_MS) {
    days.push({ from: new Date(t), to: new Date(t + DAY_MS) });
  }
  return newestFirst ? days.reverse() : days;
}

/** Duración de Google ("3309.22s") en segundos. */
export function parseDuration(value) {
  if (typeof value !== 'string') return null;
  const seconds = Number.parseFloat(value);
  return Number.isFinite(seconds) ? seconds : null;
}
