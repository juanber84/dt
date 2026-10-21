import { describe, expect, it } from 'vitest';
import {
  fmtClock,
  fmtDuration,
  fmtInt,
  fmtDec,
  fmtSigned,
  fmtCompact,
  hourTicks,
} from '../src/lib/format.js';
import { addDays, dateRange, isValidISODate } from '../src/lib/dates.js';
import { niceTicks, linePath, topRoundedRect } from '../src/lib/scale.js';

describe('format', () => {
  it('números en español', () => {
    expect(fmtInt(12613)).toBe('12.613');
    expect(fmtInt(1275)).toBe('1.275');
    expect(fmtDec(76.6, 1)).toBe('76,6');
    expect(fmtInt(null)).toBe('—');
  });

  it('duraciones y horas', () => {
    expect(fmtDuration(461)).toBe('7h 41m');
    expect(fmtDuration(45)).toBe('45m');
    expect(fmtDuration(120)).toBe('2h');
    expect(fmtClock(-75)).toBe('22:45');
    expect(fmtClock(1500)).toBe('01:00');
  });

  it('signo y compactos', () => {
    expect(fmtSigned(3)).toBe('+3');
    expect(fmtSigned(-1.25, 1)).toBe('−1,3');
    expect(fmtSigned(0.01)).toBe('0');
    expect(fmtCompact(12000)).toBe('12k');
    expect(fmtCompact(2500)).toBe('2,5k');
  });

  it('marcas de horas', () => {
    expect(hourTicks(470)).toEqual([0, 120, 240, 360, 480]);
    expect(hourTicks(10, 3)).toEqual([0, 180]);
  });
});

describe('dates', () => {
  it('suma días cruzando meses', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(dateRange('2026-10-14', 3)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
  });

  it('valida fechas', () => {
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2026-10-14')).toBe(true);
    expect(isValidISODate('hoy')).toBe(false);
  });
});

describe('scale', () => {
  it('ticks redondos que cubren el rango', () => {
    expect(niceTicks(3, 97, 4).ticks).toEqual([0, 25, 50, 75, 100]);
    // Lo que se cuenta: sin cuartos aunque la escala sea de 0 a 1
    expect(niceTicks(0, 1, 4, { integer: true }).ticks).toEqual([0, 1]);
    expect(niceTicks(0, 1, 4).ticks).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('las líneas saltan los huecos', () => {
    expect(linePath([[0, 0], null, [2, 2], [3, 3]])).toBe('M0.0,0.0M2.0,2.0L3.0,3.0');
  });

  it('una barra sin altura no dibuja nada', () => {
    expect(topRoundedRect(0, 0, 10, 0)).toBe('');
  });
});

describe('safeNext', () => {
  it('solo deja rutas internas', async () => {
    const { safeNext } = await import('../src/lib/navigation.js');
    expect(safeNext('/admin/connections?x=1')).toBe('/admin/connections?x=1');
    expect(safeNext('//evil.com')).toBeNull();
    expect(safeNext('/\\evil.com')).toBeNull();
    expect(safeNext('https://evil.com')).toBeNull();
    expect(safeNext(undefined)).toBeNull();
    expect(safeNext(['/a'])).toBeNull();
  });
});
