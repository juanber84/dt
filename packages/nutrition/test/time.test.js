import { describe, it, expect } from 'vitest';
import { fromLocalDateTime, toLocalDateTime } from '../src/time.js';

const TZ = 'Europe/Madrid';

describe('time', () => {
  it('convierte hora local a UTC en invierno (+01:00) y en verano (+02:00)', () => {
    expect(fromLocalDateTime('2026-01-15T08:30', TZ).toISOString()).toBe(
      '2026-01-15T07:30:00.000Z',
    );
    expect(fromLocalDateTime('2026-07-15T08:30', TZ).toISOString()).toBe(
      '2026-07-15T06:30:00.000Z',
    );
  });

  it('respeta el día del cambio de hora', () => {
    // 25 oct 2026: a las 03:00 (+02) vuelve a ser las 02:00 (+01)
    expect(fromLocalDateTime('2026-10-25T01:00', TZ).toISOString()).toBe(
      '2026-10-24T23:00:00.000Z',
    );
    expect(fromLocalDateTime('2026-10-25T12:00', TZ).toISOString()).toBe(
      '2026-10-25T11:00:00.000Z',
    );
  });

  it('formatea un instante como hora local', () => {
    expect(toLocalDateTime(new Date('2026-10-13T12:05:00Z'), TZ)).toBe('2026-10-13T14:05');
  });

  it('ida y vuelta', () => {
    expect(toLocalDateTime(fromLocalDateTime('2026-03-29T10:15', TZ), TZ)).toBe('2026-03-29T10:15');
  });

  it('rechaza formatos inválidos', () => {
    expect(() => fromLocalDateTime('ayer', TZ)).toThrow(/inválida/);
  });
});
