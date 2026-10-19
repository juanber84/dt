import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 1;

/**
 * Cifra objetos JSON con AES-256-GCM para guardarlos en la BD (credenciales de los conectores).
 * Formato: versión (1 byte) · iv (12) · tag (16) · texto cifrado.
 * `context` va como dato autenticado: un valor cifrado para una fila no se descifra en otra.
 * @param {string} keyHex 32 bytes en hexadecimal (openssl rand -hex 32).
 */
export function createSecretBox(keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('La clave de cifrado tiene que ser de 32 bytes (64 hex)');

  return {
    seal(value, context) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(context));
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(value), 'utf8'),
        cipher.final(),
      ]);
      return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), encrypted]);
    },

    /** Lanza si la clave no es la misma, el contexto no coincide o el dato está manipulado. */
    open(sealed, context) {
      const buffer = Buffer.from(sealed);
      if (buffer[0] !== VERSION) throw new Error(`Versión de cifrado desconocida: ${buffer[0]}`);
      const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(1, 13));
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(buffer.subarray(13, 29));
      const plain = Buffer.concat([decipher.update(buffer.subarray(29)), decipher.final()]);
      return JSON.parse(plain.toString('utf8'));
    },
  };
}
