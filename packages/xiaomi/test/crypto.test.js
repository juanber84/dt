import { describe, it, expect } from 'vitest';
import {
  rc4,
  encryptValue,
  decryptValue,
  buildEncryptedForm,
  generateSignedNonce,
  generateNonce,
  md5Upper,
} from '../src/crypto.js';

describe('crypto', () => {
  it('rc4 cumple el vector de test estándar (sin descarte)', () => {
    const out = rc4(Buffer.from('Key'), Buffer.from('Plaintext'), 0);
    expect(out.toString('hex')).toBe('bbf316e8d940af0ad3');
  });

  it('cifrar y descifrar es reversible', () => {
    const key = generateSignedNonce(Buffer.from('secret').toString('base64'), generateNonce());
    expect(decryptValue(key, encryptValue(key, '{"a":1}'))).toBe('{"a":1}');
  });

  it('el nonce lleva los minutos Unix en los últimos 4 bytes', () => {
    const now = 1_700_000_000_000;
    expect(generateNonce(now).readUInt32BE(8)).toBe(Math.floor(now / 60000));
  });

  it('buildEncryptedForm es determinista para un nonce dado', () => {
    const ssecurity = Buffer.from('ssecurity').toString('base64');
    const nonce = Buffer.alloc(12, 1);
    const a = buildEncryptedForm(ssecurity, '/x', '{"a":1}', nonce);
    const b = buildEncryptedForm(ssecurity, '/x', '{"a":1}', nonce);

    expect(a.form).toEqual(b.form);
    expect(Object.keys(a.form)).toEqual(['data', 'rc4_hash__', 'signature', '_nonce']);
    expect(decryptValue(a.signedNonce, a.form.data)).toBe('{"a":1}');
  });

  it('md5Upper', () => {
    expect(md5Upper('abc')).toBe('900150983CD24FB0D6963F7D28E17F72');
  });
});
