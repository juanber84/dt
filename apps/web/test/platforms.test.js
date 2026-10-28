import { describe, it, expect } from 'vitest';
import {
  CATEGORIES,
  PLATFORMS,
  STATES,
  matchesPlatform,
  platformById,
} from '../src/data/platforms.js';
import { DATA_TYPES, SOURCES } from '../src/data/sources.js';

describe('catálogo de plataformas', () => {
  it('cada una con categoría, estado, datos y fuente que existen', () => {
    for (const p of PLATFORMS) {
      expect(CATEGORIES[p.category], p.id).toBeDefined();
      expect(STATES[p.state], p.id).toBeDefined();
      expect(p.icon || p.monogram || p.logo, p.id).toBeTruthy();
      for (const t of p.provides) expect(DATA_TYPES[t], `${p.id}: ${t}`).toBeDefined();
      if (p.source) expect(SOURCES[p.source], p.id).toBeDefined();
      if (p.state === 'via') {
        expect(p.via?.length, p.id).toBeGreaterThan(0);
        for (const v of p.via) expect(platformById(v)?.source, `${p.id} → ${v}`).toBeTruthy();
      }
    }
    expect(new Set(PLATFORMS.map((p) => p.id)).size).toBe(PLATFORMS.length);
  });

  it('enlaces solo https', () => {
    for (const p of PLATFORMS) {
      for (const url of Object.values(p.links)) expect(url, p.id).toMatch(/^https:\/\//);
    }
  });

  it('busca por nombre y por dato, sin tildes ni mayúsculas', () => {
    const garmin = platformById('garmin');
    expect(matchesPlatform(garmin, 'GARM')).toBe(true);
    expect(matchesPlatform(platformById('xiaomi'), 'bascula')).toBe(true);
    expect(matchesPlatform(platformById('ultrahuman'), 'sueño', DATA_TYPES)).toBe(true);
    expect(matchesPlatform(garmin, 'tostadora')).toBe(false);
    expect(matchesPlatform(garmin, '  ')).toBe(true);
  });
});
