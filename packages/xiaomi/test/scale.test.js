import { describe, it, expect, vi } from 'vitest';
import { getScaleMeasurements, parseMeasurement, SCALE_METRICS } from '../src/scale.js';

const BASE = Date.UTC(2026, 0, 1);
const HOUR = 3600_000;

function item(createTime, extra = {}) {
  return {
    did: 'blt.1.test',
    model: 'yunmai.scales.ms104',
    createTime,
    fromSource: 2,
    data: JSON.stringify({
      weight: 70.5,
      bfp: 18,
      bfm: 12.7,
      ffm: 57.8,
      whr: 0.9,
      heartRate: '60',
      bodyRes: 480.5,
      bodyRes2: 420,
      user: { name: 'test', height: 175, sex: 'male', birth: '1990-01-01' },
    }),
    ...extra,
  };
}

/** Cliente falso: devuelve en páginas de 20 (de más nuevo a más viejo) los items <= beginTime. */
function fakeClient(allItems) {
  const sorted = [...allItems].sort((a, b) => b.createTime - a.createTime);
  return {
    credentials: { userId: '1' },
    request: vi.fn(async (_path, payload) =>
      sorted.filter((i) => i.createTime <= payload.beginTime).slice(0, 20),
    ),
  };
}

describe('parseMeasurement', () => {
  it('normaliza fromSource 2', () => {
    const m = parseMeasurement(item(BASE));
    expect(m).toMatchObject({
      id: `blt.1.test:${BASE}`,
      timestamp: BASE,
      date: new Date(BASE).toISOString(),
      weight: 70.5,
      bodyFat: 18,
      heartRate: 60,
      fatMass: 12.7,
      leanBodyMass: 57.8,
      waistHipRatio: 0.9,
      impedanceLow: 480.5,
      impedanceHigh: 420,
      height: 175,
      user: 'test',
      profile: { name: 'test', sex: 'male', birth: '1990-01-01', height: 175 },
    });
  });

  it('incluye todas las métricas conocidas (null si no vienen)', () => {
    const m = parseMeasurement(item(BASE));
    for (const { key } of SCALE_METRICS) expect(m).toHaveProperty(key);
    expect(m.smi).toBeNull();
  });

  it('normaliza fromSource 3 con bodyResData y fecha en data.time', () => {
    const m = parseMeasurement({
      did: 'd',
      createTime: BASE,
      fromSource: 3,
      data: JSON.stringify({
        time: String((BASE + HOUR) / 1000),
        weight: '60',
        bodyRes: '500',
        bodyResData: JSON.stringify({ bfp: '12.1', smi: '7.2' }),
      }),
    });
    expect(m.timestamp).toBe(BASE + HOUR);
    expect(m).toMatchObject({ weight: 60, impedanceLow: 500, bodyFat: 12.1, smi: 7.2 });
  });

  it('marca fromSource desconocido', () => {
    expect(parseMeasurement(item(BASE, { fromSource: 9 })).unknown).toBe(true);
  });
});

describe('getScaleMeasurements', () => {
  const items = Array.from({ length: 45 }, (_, i) => item(BASE + i * HOUR));

  it('pagina todo el histórico y devuelve orden cronológico sin duplicados', async () => {
    const client = fakeClient(items);
    const result = await getScaleMeasurements(client, { to: BASE + 100 * HOUR });

    expect(result).toHaveLength(45);
    expect(result[0].timestamp).toBe(BASE);
    expect(result.at(-1).timestamp).toBe(BASE + 44 * HOUR);
    expect(client.request).toHaveBeenCalledTimes(3);
  });

  it('filtra por rango y deja de paginar al pasar "from"', async () => {
    const client = fakeClient(items);
    const result = await getScaleMeasurements(client, {
      from: new Date(BASE + 30 * HOUR),
      to: new Date(BASE + 40 * HOUR),
    });

    expect(result.map((m) => (m.timestamp - BASE) / HOUR)).toEqual([
      30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
    ]);
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request.mock.calls[0][1]).toMatchObject({
      beginTime: BASE + 40 * HOUR,
      uid: '1',
    });
  });

  it('rechaza rangos invertidos', async () => {
    await expect(
      getScaleMeasurements(fakeClient([]), { from: BASE + HOUR, to: BASE }),
    ).rejects.toThrow(RangeError);
  });
});
