import { XiaomiError, XiaomiErrorCode } from './errors.js';

export const DEFAULT_SCALE_MODEL = 'yunmai.scales.ms104';
const SCALE_PATH = '/eco/common/scale/getUserDataByPage';
const PAGE_SIZE = 20;
const MAX_PAGES = 1000;

function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseJSONString(value) {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function toTimestamp(value) {
  let ts = Number(value);
  if (!value || !Number.isFinite(ts)) return null;
  if (ts < 100000000000) ts *= 1000; // segundos -> ms
  return ts;
}

function toMillis(value, name) {
  if (value === undefined || value === null) return undefined;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(ms)) throw new TypeError(`Fecha inválida en "${name}": ${value}`);
  return ms;
}

/**
 * Métricas que puede devolver la báscula: clave normalizada, clave de Xiaomi, etiqueta y unidad.
 * Las mismas claves vienen en `data` (fromSource 1 y 2) o en `data.bodyResData` (fromSource 3).
 */
export const SCALE_METRICS = Object.freeze([
  { key: 'weight', xiaomi: 'weight', label: 'Peso', unit: 'kg' },
  { key: 'bmi', xiaomi: 'bmi', label: 'IMC', unit: null },
  { key: 'bodyFat', xiaomi: 'bfp', label: 'Grasa corporal', unit: '%' },
  { key: 'fatMass', xiaomi: 'bfm', label: 'Masa grasa', unit: 'kg' },
  { key: 'leanBodyMass', xiaomi: 'ffm', label: 'Masa libre de grasa', unit: 'kg' },
  { key: 'bodyWater', xiaomi: 'bwp', label: 'Agua corporal', unit: '%' },
  { key: 'bodyWaterMass', xiaomi: 'bwm', label: 'Masa de agua', unit: 'kg' },
  { key: 'muscleMass', xiaomi: 'slm', label: 'Masa muscular', unit: 'kg' },
  { key: 'musclePercent', xiaomi: 'slp', label: 'Músculo', unit: '%' },
  { key: 'skeletalMuscleMass', xiaomi: 'smm', label: 'Músculo esquelético', unit: 'kg' },
  { key: 'smi', xiaomi: 'smi', label: 'Índice músculo esquelético', unit: 'kg/m²' },
  { key: 'boneMass', xiaomi: 'bmc', label: 'Masa ósea', unit: 'kg' },
  { key: 'bonePercent', xiaomi: 'bmcp', label: 'Hueso', unit: '%' },
  { key: 'proteinMass', xiaomi: 'pm', label: 'Proteína', unit: 'kg' },
  { key: 'proteinPercent', xiaomi: 'pp', label: 'Proteína', unit: '%' },
  { key: 'visceralFat', xiaomi: 'vfl', label: 'Grasa visceral', unit: null },
  { key: 'basalMetabolism', xiaomi: 'bmr', label: 'Metabolismo basal', unit: 'kcal' },
  { key: 'metabolicAge', xiaomi: 'ma', label: 'Edad metabólica', unit: 'años' },
  { key: 'physiqueRating', xiaomi: 'bt', label: 'Tipo de cuerpo', unit: null },
  { key: 'bodyScore', xiaomi: 'sbc', label: 'Puntuación corporal', unit: null },
  { key: 'idealWeight', xiaomi: 'swt', label: 'Peso ideal', unit: 'kg' },
  { key: 'weightControl', xiaomi: 'wc', label: 'Control de peso', unit: 'kg' },
  { key: 'fatControl', xiaomi: 'fc', label: 'Control de grasa', unit: 'kg' },
  { key: 'muscleControl', xiaomi: 'mc', label: 'Control de músculo', unit: 'kg' },
  { key: 'waistHipRatio', xiaomi: 'whr', label: 'Ratio cintura-cadera', unit: null },
  { key: 'heartRate', xiaomi: 'heartRate', label: 'Frecuencia cardíaca', unit: 'bpm' },
  { key: 'impedanceLow', xiaomi: 'bodyRes', label: 'Impedancia baja frecuencia', unit: 'Ω' },
  { key: 'impedanceHigh', xiaomi: 'bodyRes2', label: 'Impedancia alta frecuencia', unit: 'Ω' },
]);

function parseProfile(user = {}) {
  return {
    name: user.name ?? null,
    sex: user.sex ?? null,
    birth: user.birth ?? null,
    height: toNumber(user.height),
    weightTarget: toNumber(user.weightTarget),
  };
}

/**
 * Normaliza un registro crudo de Xiaomi (fromSource 1, 2 o 3) con todas las métricas de
 * SCALE_METRICS (null si no vienen). `id` es estable (did + createTime) para deduplicar al guardar.
 */
export function parseMeasurement(item) {
  const data = parseJSONString(item.data);
  const fromSource = Number(item.fromSource);
  const known = [1, 2, 3].includes(fromSource);

  // fromSource 3 trae la composición corporal anidada en bodyResData
  const values = fromSource === 3 ? { ...data, ...parseJSONString(data.bodyResData) } : data;
  const timestamp = toTimestamp(fromSource === 3 ? data.time : item.createTime);

  const metrics = {};
  for (const { key, xiaomi } of SCALE_METRICS) metrics[key] = toNumber(values[xiaomi]);

  const source = {
    1: data.reportFrom,
    2: data.user?.deviceId ?? item.did,
    3: item.did,
  }[fromSource];

  return {
    id: `${item.did ?? 'unknown'}:${item.createTime}`,
    did: item.did ?? null,
    model: item.model ?? null,
    fromSource,
    timestamp,
    date: timestamp ? new Date(timestamp).toISOString() : null,
    user: data.user?.name ?? null,
    source: source ?? null,
    height: toNumber(data.user?.height),
    profile: parseProfile(data.user),
    ...metrics,
    ...(known ? {} : { unknown: true }),
    raw: item,
  };
}

/**
 * Descarga las mediciones de la báscula en un rango de fechas.
 *
 * La API pagina hacia atrás desde `beginTime` (lo más reciente) en páginas de 20;
 * se corta en cuanto la página ya llega a registros anteriores a `from`.
 *
 * @param {import('./client.js').XiaomiCloudClient} client
 * @param {object} [options]
 * @param {Date|string|number} [options.from]  Incluido. Sin valor: desde el principio.
 * @param {Date|string|number} [options.to]    Incluido. Sin valor: ahora.
 * @param {string} [options.model]
 * @returns {Promise<ReturnType<typeof parseMeasurement>[]>} Ordenadas de más antigua a más reciente.
 */
export async function getScaleMeasurements(client, { from, to, model = DEFAULT_SCALE_MODEL } = {}) {
  const fromMs = toMillis(from, 'from') ?? 0;
  const toMs = toMillis(to, 'to') ?? Date.now();
  if (fromMs > toMs) throw new RangeError('"from" no puede ser posterior a "to"');

  const byId = new Map();
  let beginTime = toMs;

  for (let page = 1; ; page++) {
    const items = await client.request(
      SCALE_PATH,
      {
        endTime: 1,
        beginTime,
        model,
        uid: String(client.credentials.userId),
        did: 0,
        accountId: 0,
      },
      { 'MIOT-REQUEST-MODEL': model },
    );

    if (!Array.isArray(items)) {
      throw new XiaomiError(XiaomiErrorCode.UNEXPECTED_RESPONSE, 'Xiaomi result no es un array');
    }

    for (const item of items) {
      const measurement = parseMeasurement(item);
      const ts = measurement.timestamp ?? toTimestamp(item.createTime);
      if (ts !== null && ts >= fromMs && ts <= toMs) byId.set(measurement.id, measurement);
    }

    if (items.length < PAGE_SIZE) break;

    const nextBeginTime = Number(items[PAGE_SIZE - 1]?.createTime);
    if (!nextBeginTime || nextBeginTime >= beginTime) break; // la paginación no avanza
    if (nextBeginTime < fromMs) break; // ya hemos pasado el inicio del rango
    beginTime = nextBeginTime;

    if (page >= MAX_PAGES) {
      throw new XiaomiError(XiaomiErrorCode.UNEXPECTED_RESPONSE, 'Límite de páginas alcanzado');
    }
  }

  return [...byId.values()].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}
