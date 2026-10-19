import { describe, it, expect, vi } from 'vitest';
import { DATA_TYPES, getDataType, dataTypesForScopes, SCOPES } from '../src/data-types.js';
import { buildFilter, listDataPoints, toCivil, toRecord, getAllData } from '../src/data.js';
import { GoogleHealthError } from '../src/errors.js';

const from = new Date('2026-10-01T00:00:00Z');
const to = new Date('2026-10-02T00:00:00Z');
const tz = 'Europe/Madrid';

describe('catálogo', () => {
  it('ids únicos y campo camelCase', () => {
    expect(new Set(DATA_TYPES.map((d) => d.id)).size).toBe(DATA_TYPES.length);
    expect(getDataType('heart-rate').field).toBe('heartRate');
    expect(getDataType('daily-vo2-max').field).toBe('dailyVo2Max');
    expect(() => getDataType('nope')).toThrow(/desconocido/);
  });

  it('filtra por scopes concedidos', () => {
    const ids = dataTypesForScopes(`${SCOPES.SLEEP} ${SCOPES.ECG}`).map((d) => d.id);
    expect(ids).toEqual(['sleep', 'electrocardiogram']);
  });
});

describe('buildFilter', () => {
  it.each([
    [
      'steps',
      'steps.interval.start_time >= "2026-10-01T00:00:00.000Z" AND steps.interval.start_time < "2026-10-02T00:00:00.000Z"',
    ],
    [
      'heart-rate',
      'heart_rate.sample_time.physical_time >= "2026-10-01T00:00:00.000Z" AND heart_rate.sample_time.physical_time < "2026-10-02T00:00:00.000Z"',
    ],
    [
      'sleep',
      'sleep.interval.end_time >= "2026-10-01T00:00:00.000Z" AND sleep.interval.end_time < "2026-10-02T00:00:00.000Z"',
    ],
    ['electrocardiogram', 'electrocardiogram.interval.start_time >= "2026-10-01T00:00:00.000Z"'],
    [
      'exercise',
      'exercise.interval.civil_start_time >= "2026-10-01T02:00:00" AND exercise.interval.civil_start_time < "2026-10-02T02:00:00"',
    ],
    [
      'daily-resting-heart-rate',
      'daily_resting_heart_rate.date >= "2026-10-01" AND daily_resting_heart_rate.date < "2026-10-03"',
    ],
  ])('%s', (type, expected) => {
    expect(buildFilter(type, { from, to, timeZone: tz })).toBe(expected);
  });

  it('toCivil respeta la zona horaria', () => {
    expect(toCivil(new Date('2026-10-01T22:30:00Z'), tz)).toEqual({
      date: '2026-10-02',
      dateTime: '2026-10-02T00:30:00',
    });
  });
});

function fakeClient(pages) {
  return { request: vi.fn(async () => pages.shift() ?? {}) };
}

const hr = (time, bpm) => ({
  heartRate: { sampleTime: { physicalTime: time }, beatsPerMinute: bpm },
});

describe('listDataPoints', () => {
  it('pagina y devuelve en orden cronológico', async () => {
    const client = fakeClient([
      {
        dataPoints: [hr('2026-10-01T10:00:00Z', '70'), hr('2026-10-01T09:00:00Z', '60')],
        nextPageToken: 'p2',
      },
      { dataPoints: [hr('2026-10-01T08:00:00Z', '55')] },
    ]);
    const points = await listDataPoints(client, 'heart-rate', { from, to });

    expect(points.map((p) => p.heartRate.beatsPerMinute)).toEqual(['55', '60', '70']);
    expect(client.request).toHaveBeenCalledTimes(2);
    expect(client.request.mock.calls[0][0]).toBe('/users/me/dataTypes/heart-rate/dataPoints');
    expect(client.request.mock.calls[1][1].params.pageToken).toBe('p2');
  });

  it('ECG: filtra el "hasta" en cliente', async () => {
    const ecg = (t) => ({ electrocardiogram: { interval: { startTime: t } } });
    const client = fakeClient([
      { dataPoints: [ecg('2026-10-03T00:00:00Z'), ecg('2026-10-01T05:00:00Z')] },
    ]);
    const points = await listDataPoints(client, 'electrocardiogram', { from, to });
    expect(points).toHaveLength(1);
    expect(client.request.mock.calls[0][1].params.pageSize).toBe(100);
  });

  it('floors usa :reconcile', async () => {
    const client = fakeClient([{}]);
    await listDataPoints(client, 'floors', { from, to });
    expect(client.request.mock.calls[0][0]).toBe('/users/me/dataTypes/floors/dataPoints:reconcile');
  });

  it('rechaza rangos vacíos', async () => {
    await expect(listDataPoints(fakeClient([]), 'steps', { from: to, to: from })).rejects.toThrow(
      RangeError,
    );
  });
});

describe('getAllData', () => {
  it('sigue con el resto de tipos si uno falla por permisos', async () => {
    const client = {
      request: vi.fn(async (path) => {
        if (path.includes('/sleep/')) throw new GoogleHealthError('PERMISSION_DENIED', 'sin scope');
        return { dataPoints: [] };
      }),
    };
    const { data, errors } = await getAllData(client, { types: ['steps', 'sleep'], from, to });
    expect(data.steps).toEqual([]);
    expect(errors.sleep.code).toBe('PERMISSION_DENIED');
  });

  it('corta si hay que volver a autorizar', async () => {
    const client = {
      request: async () => {
        throw new GoogleHealthError('REAUTH_REQUIRED', 'x');
      },
    };
    await expect(getAllData(client, { types: ['steps'], from, to })).rejects.toMatchObject({
      code: 'REAUTH_REQUIRED',
    });
  });
});

describe('toRecord', () => {
  it('id estable usando name o tiempo + fuente', () => {
    const p = { ...hr('2026-10-01T10:00:00Z', '70'), dataSource: { platform: 'FITBIT' } };
    const a = toRecord('heart-rate', p);
    expect(a).toMatchObject({
      dataType: 'heart-rate',
      start: '2026-10-01T10:00:00Z',
      value: p.heartRate,
    });
    expect(toRecord('heart-rate', { ...p }).id).toBe(a.id);
    expect(
      toRecord('sleep', { name: 'users/1/dataTypes/sleep/dataPoints/abc', sleep: {} }).id,
    ).toBe('users/1/dataTypes/sleep/dataPoints/abc');
  });

  it('tipos diarios usan date', () => {
    const r = toRecord('daily-resting-heart-rate', {
      dailyRestingHeartRate: { date: { year: 2026, month: 10, day: 1 }, beatsPerMinute: '52' },
    });
    expect(r.date).toBe('2026-10-01');
  });
});
