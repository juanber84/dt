import { describe, expect, it } from 'vitest';
import { daySummary, dayDetail } from '../src/data/mock.js';

describe('datos de ejemplo', () => {
  it('son deterministas por fecha', () => {
    expect(daySummary('2026-09-01')).toEqual(daySummary('2026-09-01'));
    expect(daySummary('2026-09-01').recovery).not.toBe(undefined);
  });

  it('el día trae eventos ordenados con sus fuentes', () => {
    const day = dayDetail('2026-09-02');
    expect(day.events.length).toBeGreaterThan(3);
    const starts = day.events.map((e) => e.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    for (const e of day.events) {
      expect(e.sources.filter((s) => s.primary)).toHaveLength(1);
    }
    expect(day.hr.length).toBe(288);
    expect(day.stepsByHour.reduce((a, b) => a + b, 0)).toBeCloseTo(day.steps, -2);
  });

  it('las fases del sueño cubren la noche sin huecos', () => {
    const { stages, start, end } = dayDetail('2026-09-03').sleepDetail;
    expect(stages[0].start).toBe(start);
    expect(stages.at(-1).end).toBe(end);
    stages.slice(1).forEach((s, i) => expect(s.start).toBe(stages[i].end));
  });
});
