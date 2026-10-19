const formatters = new Map();

function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    );
  }
  return formatters.get(timeZone);
}

function parts(date, timeZone) {
  return Object.fromEntries(
    formatter(timeZone)
      .formatToParts(date)
      .map(({ type, value }) => [type, value]),
  );
}

/** Desfase (ms) de la zona horaria respecto a UTC en ese instante. */
function offsetMs(date, timeZone) {
  const p = parts(date, timeZone);
  const asUtc = Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Fecha y hora local "YYYY-MM-DDTHH:mm" en la zona indicada.
 * @param {Date} date
 * @param {string} timeZone p. ej. "Europe/Madrid"
 */
export function toLocalDateTime(date, timeZone) {
  const p = parts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * Convierte una hora local "YYYY-MM-DDTHH:mm" de una zona horaria a Date (instante UTC).
 * Tiene en cuenta el cambio de hora.
 */
export function fromLocalDateTime(local, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!match) throw new Error(`Fecha local inválida: "${local}"`);
  const [, y, mo, d, h, mi] = match.map(Number);
  const wallClock = Date.UTC(y, mo - 1, d, h, mi);

  const first = wallClock - offsetMs(new Date(wallClock), timeZone);
  const second = wallClock - offsetMs(new Date(first), timeZone);
  return new Date(second);
}
