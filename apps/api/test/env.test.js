import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config/env.js';

describe('loadConfig', () => {
  it('aplica valores por defecto', () => {
    const config = loadConfig({});
    expect(config.PORT).toBe(3000);
    expect(config.CORS_ORIGINS).toEqual(['*']);
  });

  it('parsea la lista de orígenes CORS', () => {
    const config = loadConfig({ CORS_ORIGINS: 'http://a.com, http://b.com' });
    expect(config.CORS_ORIGINS).toEqual(['http://a.com', 'http://b.com']);
  });

  it('falla con valores inválidos', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Configuración inválida/);
  });

  it('DATABASE_URL es opcional y tiene que ser de Postgres', () => {
    expect(loadConfig({}).DATABASE_URL).toBeUndefined();
    const url = 'postgres://digitaltwin:clave@digitaltwin-db:5432/digitaltwin';
    expect(loadConfig({ DATABASE_URL: url }).DATABASE_URL).toBe(url);
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
  });
});
