import { describe, it, expect } from 'vitest';
import { endOfDayISO } from '../src/services/users.js';

describe('endOfDayISO', () => {
  it('el día local hasta su último segundo; vacío es sin caducidad', () => {
    const iso = endOfDayISO('2026-11-26');
    const end = new Date(iso);
    expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([2026, 10, 26]);
    expect([end.getHours(), end.getMinutes(), end.getSeconds()]).toEqual([23, 59, 59]);
    expect(endOfDayISO('')).toBeNull();
  });
});
