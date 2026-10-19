import crypto from 'node:crypto';
import { getDataType, DATA_TYPES } from './data-types.js';
import { GoogleHealthErrorCode } from './errors.js';

const DEFAULT_PAGE_SIZE = 10000;
const MAX_PAGES = 10000;

function toDate(value, name) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`Fecha inválida en "${name}": ${value}`);
  return date;
}

/** Fecha/hora local (sin zona) en `timeZone`: { date: 'YYYY-MM-DD', dateTime: 'YYYY-MM-DDTHH:mm:ss' } */
export function toCivil(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return { date: day, dateTime: `${day}T${parts.hour}:${parts.minute}:${parts.second}` };
}

function nextDay(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Construye el filtro AIP-160 según la clase del tipo. Rango [from, to).
 * @returns {string}
 */
export function buildFilter(dataTypeId, { from, to, timeZone }) {
  const type = getDataType(dataTypeId);
  const f = type.filterField;
  const range = (field, a, b) => `${field} >= "${a}" AND ${field} < "${b}"`;

  switch (type.kind) {
    case 'interval':
      return range(`${f}.interval.start_time`, from.toISOString(), to.toISOString());
    case 'sample':
      return range(`${f}.sample_time.physical_time`, from.toISOString(), to.toISOString());
    case 'sleep':
      return range('sleep.interval.end_time', from.toISOString(), to.toISOString());
    case 'ecg':
      return `electrocardiogram.interval.start_time >= "${from.toISOString()}"`;
    case 'session':
      return range(
        `${f}.interval.civil_start_time`,
        toCivil(from, timeZone).dateTime,
        toCivil(to, timeZone).dateTime,
      );
    case 'daily':
      // Incluye el día que contiene el último instante del rango
      return range(
        `${f}.date`,
        toCivil(from, timeZone).date,
        nextDay(toCivil(new Date(to.getTime() - 1), timeZone).date),
      );
    default:
      throw new Error(`Clase de tipo no soportada: ${type.kind}`);
  }
}

function civilToString(civil) {
  if (!civil?.date) return null;
  const { year, month, day } = civil.date;
  const pad = (n) => String(n ?? 0).padStart(2, '0');
  const date = `${year}-${pad(month)}-${pad(day)}`;
  if (!civil.time) return date;
  return `${date}T${pad(civil.time.hours)}:${pad(civil.time.minutes)}:${pad(civil.time.seconds)}`;
}

/**
 * Tiempos de un data point: `start`/`end` en ISO (instante) o, para tipos diarios, `date` (YYYY-MM-DD).
 */
export function getPointTime(dataTypeId, point) {
  const type = getDataType(dataTypeId);
  const value = point[type.field] ?? {};
  if (value.interval) {
    return {
      start: value.interval.startTime ?? null,
      end: value.interval.endTime ?? null,
      civilStart: civilToString(value.interval.civilStartTime),
    };
  }
  if (value.sampleTime) {
    return {
      start: value.sampleTime.physicalTime ?? null,
      end: null,
      civilStart: civilToString(value.sampleTime.civilTime),
    };
  }
  if (value.date) return { start: null, end: null, date: civilToString({ date: value.date }) };
  return { start: null, end: null };
}

function sortKey(time) {
  return time.start ?? time.date ?? time.civilStart ?? '';
}

/**
 * Registro normalizado para guardar en BD de forma genérica (una tabla para todos los tipos).
 * `id` es estable: el `name` del punto si la API lo da, o tipo + tiempo + hash de la fuente.
 */
export function toRecord(dataTypeId, point) {
  const type = getDataType(dataTypeId);
  const time = getPointTime(dataTypeId, point);
  const sourceHash = crypto
    .createHash('sha1')
    .update(JSON.stringify(point.dataSource ?? {}))
    .digest('hex')
    .slice(0, 12);

  return {
    id: point.name ?? `${type.id}|${sortKey(time)}|${time.end ?? ''}|${sourceHash}`,
    dataType: type.id,
    start: time.start,
    end: time.end,
    date: time.date ?? null,
    value: point[type.field] ?? null,
    dataSource: point.dataSource ?? null,
    raw: point,
  };
}

/**
 * Lee todos los data points de un tipo en [from, to), paginando.
 * @param {import('./client.js').GoogleHealthClient} client
 * @param {string} dataTypeId  p. ej. 'steps', 'heart-rate', 'sleep', 'electrocardiogram'
 * @param {object} options
 * @param {Date|string|number} options.from
 * @param {Date|string|number} [options.to]  por defecto ahora
 * @param {string} [options.timeZone]  Para tipos con filtro local (diarios y sesiones). Por defecto la del proceso.
 * @param {boolean} [options.reconcile]  Usa :reconcile (une varias fuentes en un solo flujo).
 * @param {string} [options.dataSourceFamily]  'all-sources' | 'google-wearables' | ...
 * @returns {Promise<object[]>} data points crudos en orden cronológico
 */
export async function listDataPoints(
  client,
  dataTypeId,
  {
    from,
    to = new Date(),
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
    reconcile,
    dataSourceFamily,
  } = {},
) {
  const type = getDataType(dataTypeId);
  const fromDate = toDate(from, 'from');
  const toDateValue = toDate(to, 'to');
  if (fromDate >= toDateValue) throw new RangeError('"from" tiene que ser anterior a "to"');

  const method = reconcile || type.method === 'reconcile' ? ':reconcile' : '';
  const path = `/users/me/dataTypes/${type.id}/dataPoints${method}`;
  const params = {
    filter: buildFilter(type.id, { from: fromDate, to: toDateValue, timeZone }),
    pageSize: type.pageSize ?? DEFAULT_PAGE_SIZE,
    ...(dataSourceFamily
      ? { dataSourceFamily: `users/me/dataSourceFamilies/${dataSourceFamily}` }
      : {}),
  };

  const points = [];
  let pageToken;
  let pages = 0;
  do {
    const page = await client.request(path, { params: { ...params, pageToken } });
    points.push(...(page.dataPoints ?? []));
    pageToken = page.nextPageToken;
    if (++pages >= MAX_PAGES) throw new Error(`Demasiadas páginas leyendo ${type.id}`);
  } while (pageToken);

  // El ECG solo admite "desde" en el filtro
  const filtered =
    type.kind === 'ecg'
      ? points.filter((p) => {
          const { start } = getPointTime(type.id, p);
          return !start || new Date(start) < toDateValue;
        })
      : points;

  // La API devuelve en orden descendente
  return filtered
    .map((point) => ({ point, key: sortKey(getPointTime(type.id, point)) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ point }) => point);
}

/**
 * Lee varios tipos (por defecto todos los del catálogo). No para en el primer error:
 * los tipos sin permiso o que fallan se devuelven en `errors`.
 * @returns {Promise<{ data: Record<string, object[]>, errors: Record<string, { code: string, message: string }> }>}
 */
export async function getAllData(client, { types = DATA_TYPES.map((d) => d.id), ...options } = {}) {
  const data = {};
  const errors = {};
  for (const id of types) {
    try {
      data[id] = await listDataPoints(client, id, options);
    } catch (error) {
      if (error.code === GoogleHealthErrorCode.REAUTH_REQUIRED) throw error;
      errors[id] = { code: error.code ?? 'ERROR', message: error.message };
    }
  }
  return { data, errors };
}
