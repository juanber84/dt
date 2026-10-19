import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createSecretBox } from '../src/secret-box.js';

const key = () => randomBytes(32).toString('hex');

describe('createSecretBox', () => {
  it('cifra y descifra un objeto; cada vez con un iv distinto', () => {
    const box = createSecretBox(key());
    const value = { serviceToken: 'st', passToken: 'pt' };
    const a = box.seal(value, 'ctx');
    const b = box.seal(value, 'ctx');
    expect(a.equals(b)).toBe(false);
    expect(a.toString('latin1')).not.toContain('serviceToken');
    expect(box.open(a, 'ctx')).toEqual(value);
  });

  it('falla con otra clave, otro contexto o el dato manipulado', () => {
    const box = createSecretBox(key());
    const sealed = box.seal({ a: 1 }, 'connections:u1:xiaomi');
    expect(() => createSecretBox(key()).open(sealed, 'connections:u1:xiaomi')).toThrow();
    expect(() => box.open(sealed, 'connections:u2:xiaomi')).toThrow();
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 1;
    expect(() => box.open(tampered, 'connections:u1:xiaomi')).toThrow();
  });

  it('exige una clave de 32 bytes', () => {
    expect(() => createSecretBox('abcd')).toThrow(/32 bytes/);
  });
});
