import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config/env.js';

const base = {
  TELEGRAM_BOT_TOKEN: '123456:ABC-def_ghi',
  TELEGRAM_ALLOWED_USER_IDS: '111, 222',
  DIGITALTWIN_API_KEY: 'clave-de-pruebas-larga',
};

describe('loadConfig', () => {
  it('aplica valores por defecto (Madrid, API local)', () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({
      TELEGRAM_ALLOWED_USER_IDS: [111, 222],
      TIMEZONE: 'Europe/Madrid',
      API_URL: 'http://localhost:3000',
    });
  });

  it('falla si faltan variables obligatorias', () => {
    expect(() => loadConfig({})).toThrow(/TELEGRAM_BOT_TOKEN/);
    expect(() => loadConfig({ ...base, TELEGRAM_ALLOWED_USER_IDS: 'yo@gmail.com' })).toThrow(
      /TELEGRAM_ALLOWED_USER_IDS.*cada ID es un número/,
    );
  });

  it('sin IDs arranca en modo configuración', () => {
    expect(
      loadConfig({ ...base, TELEGRAM_ALLOWED_USER_IDS: '' }).TELEGRAM_ALLOWED_USER_IDS,
    ).toEqual([]);
    const rest = { ...base };
    delete rest.TELEGRAM_ALLOWED_USER_IDS;
    expect(loadConfig(rest).TELEGRAM_ALLOWED_USER_IDS).toEqual([]);
  });
});
