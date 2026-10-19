import { describe, it, expect } from 'vitest';
import { redactPersonalData, MASK } from '../src/redact.js';
import { LAB_TEXT, HOLTER_TEXT } from './fixtures.js';

const PERSONAL = [
  'PEREZ',
  'GOMEZ',
  'PEDRO',
  '99887766',
  '12345678Z',
  '1111222233334444',
  '01/02/1980',
  'LOPEZ',
  'Laura',
];

describe('redactPersonalData', () => {
  it('quita la cabecera de datos del paciente de una analítica y deja los resultados', () => {
    const { text, count } = redactPersonalData(LAB_TEXT);
    for (const value of PERSONAL) expect(text).not.toContain(value);
    expect(count).toBeGreaterThan(0);
    expect(text).toContain('Comentario de informe:');
    expect(text).toMatch(/Creatinina\s+1\.41\s+mg\/dl\s+\(0\.6 - 1\.3\)\s+\*/);
    expect(text).toContain('Fecha:            07/10/2026');
    expect(text).toContain('Laboratorio Hospital de Pruebas');
  });

  it('quita etiquetas, NHC y "APELLIDOS , NOMBRE" sueltos de un holter sin tocar los números', () => {
    const { text } = redactPersonalData(HOLTER_TEXT);
    for (const value of PERSONAL) expect(text).not.toContain(value);
    expect(text).toContain(`Paciente:${MASK}`);
    expect(text).toContain(`Fecha de nacimiento:                 ${MASK}`);
    expect(text).toContain('Fecha de prueba:   30/09/2026');
    expect(text).toContain('SDNN: 174 SDNN5:           82 PNN50:         24');
    expect(text).toContain('   14:00 D1          50             67   105   1921');
  });

  it('quita los nombres que se le pasan aunque cambien mayúsculas y tildes', () => {
    const { text } = redactPersonalData('Informe de JUAN PÉREZ para juan.perez@x.com y Pérez', {
      names: ['Juan Perez'],
    });
    expect(text).toBe(`Informe de ${MASK} ${MASK} para ${MASK} y ${MASK}`);
  });

  it('no toca rangos, fechas ni cantidades que parecen números largos', () => {
    const line = 'Latidos totales/normales   87317 / 87315   Plaquetas 147 10e3/µL (130 - 400)';
    expect(redactPersonalData(line).text).toBe(line);
  });

  it('quita DNI, teléfonos y correos aunque no tengan etiqueta', () => {
    const { text } = redactPersonalData(
      'Contacto 612 345 678, x@y.es, doc 12345678Z, NIE X1234567L',
    );
    expect(text).toBe(`Contacto ${MASK}, ${MASK}, doc ${MASK}, NIE ${MASK}`);
  });
});
