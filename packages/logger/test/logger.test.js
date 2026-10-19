import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger, LEVELS } from '../src/index.js';

function memoryStream() {
  const lines = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  return { stream, lines };
}

describe('createLogger', () => {
  it('emite logs JSON con nombre y mensaje', () => {
    const { stream, lines } = memoryStream();
    const logger = createLogger({ name: 'test', level: 'info' }, stream);

    logger.info('hola');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ name: 'test', msg: 'hola', level: 30 });
  });

  it('respeta el nivel configurado', () => {
    const { stream, lines } = memoryStream();
    const logger = createLogger({ level: 'warn' }, stream);

    logger.info('no debe salir');
    logger.warn('sí debe salir');

    expect(lines.map((l) => l.msg)).toEqual(['sí debe salir']);
  });

  it('oculta datos sensibles', () => {
    const { stream, lines } = memoryStream();
    const logger = createLogger({ level: 'info' }, stream);

    logger.info({ user: { password: 'secreto' } }, 'login');

    expect(lines[0].user.password).toBe('[REDACTED]');
  });

  it('lanza error con un nivel inválido', () => {
    expect(() => createLogger({ level: 'verbose' })).toThrow(/Nivel de log inválido/);
  });

  it('expone los niveles soportados', () => {
    expect(LEVELS).toContain('info');
  });
});
