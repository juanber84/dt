import { describe, it, expect } from 'vitest';
import { buildExtraction, refreshExtraction, dateInText, valueInText } from '../src/review.js';
import { redactPersonalData } from '../src/redact.js';
import { modelOutputSchema } from '../src/schema.js';
import { LAB_TEXT, LAB_OUTPUT, HOLTER_TEXT, HOLTER_OUTPUT } from './fixtures.js';

const lab = () =>
  buildExtraction(modelOutputSchema.parse(LAB_OUTPUT), redactPersonalData(LAB_TEXT).text);
const holter = () =>
  buildExtraction(modelOutputSchema.parse(HOLTER_OUTPUT), redactPersonalData(HOLTER_TEXT).text);
const byName = (extraction, name) => extraction.items.find((i) => i.name === name);

describe('buildExtraction: analítica', () => {
  it('asigna métrica y convierte a su unidad', () => {
    const e = lab();
    expect(e).toMatchObject({ type: 'lab', title: 'Analítica', date: '2026-10-07', issues: [] });
    expect(byName(e, 'Volumen corpuscular medio (VCM)')).toMatchObject({
      id: 'i2',
      metric: 'lab.mcv',
      metricValue: 89.5,
      metricUnit: 'fL',
      issues: [],
    });
    expect(byName(e, 'Glucosa')).toMatchObject({
      text: '5,2',
      metric: 'lab.glucose',
      metricValue: 93.6832,
      metricUnit: 'mg/dL',
      issues: [],
    });
  });

  it('marca lo fuera de rango aunque el modelo no lo diga', () => {
    const e = lab();
    expect(byName(e, 'Creatinina').flag).toBe('high');
    const edited = refreshExtraction(
      {
        ...e,
        items: e.items.map((i) => (i.name === 'Hemoglobina' ? { ...i, value: 19, text: '19' } : i)),
      },
      LAB_TEXT,
    );
    expect(byName(edited, 'Hemoglobina')).toMatchObject({ flag: 'high', issues: ['unverified'] });
  });

  it('lo desconocido se queda sin métrica y lo cualitativo sin valor', () => {
    const e = lab();
    expect(byName(e, 'Antígeno raro')).toMatchObject({
      metric: null,
      metricValue: 12,
      metricUnit: 'U/mL',
      issues: ['unknown'],
    });
    expect(byName(e, 'Hepatitis B (HBsAg)')).toMatchObject({
      value: null,
      metricValue: null,
      issues: ['qualitative'],
    });
  });

  it('respeta la métrica que elige el usuario y avisa si la unidad no casa', () => {
    const e = lab();
    const edited = refreshExtraction(
      {
        ...e,
        items: e.items.map((i) =>
          i.name === 'Antígeno raro' ? { ...i, metric: 'lab.glucose' } : i,
        ),
      },
      LAB_TEXT,
    );
    expect(byName(edited, 'Antígeno raro')).toMatchObject({
      metric: 'lab.glucose',
      metricValue: null,
      issues: ['unit'],
    });
  });

  it('avisa si la fecha no está en el texto', () => {
    const e = buildExtraction(
      modelOutputSchema.parse({ ...LAB_OUTPUT, date: '2026-10-08' }),
      LAB_TEXT,
    );
    expect(e.issues).toEqual(['date-unverified']);
  });

  it('sin fecha en el informe usa el día desde el que se subió, para comprobarlo', () => {
    const output = modelOutputSchema.parse({ ...LAB_OUTPUT, date: null });
    expect(buildExtraction(output, LAB_TEXT).issues).toEqual(['date-missing']);
    const e = buildExtraction(output, LAB_TEXT, { fallbackDate: '2026-10-18' });
    expect(e).toMatchObject({ date: '2026-10-18', issues: ['date-unverified'] });
    // La fecha del informe manda sobre la de la subida
    const own = buildExtraction(modelOutputSchema.parse(LAB_OUTPUT), LAB_TEXT, {
      fallbackDate: '2026-10-18',
    });
    expect(own).toMatchObject({ date: '2026-10-07', issues: [] });
  });
});

describe('buildExtraction: informe', () => {
  it('guarda diagnóstico, indicaciones y reposo, sin valores', () => {
    const text = 'Informe de consulta 12/10/2026. Diagnóstico: esguince de tobillo grado I.';
    const e = buildExtraction(
      modelOutputSchema.parse({
        type: 'report',
        title: 'Consulta de traumatología',
        date: '2026-10-12',
        summary: 'Esguince leve.',
        report: {
          kind: 'injury',
          specialty: 'Traumatología',
          diagnosis: 'Esguince de tobillo grado I',
          body_part: 'Tobillo derecho',
          recommendations: ['Hielo', 'Sin correr 2 semanas'],
          rest_from: '2026-10-12',
          rest_to: '2026-10-26',
        },
      }),
      text,
    );
    expect(e).toMatchObject({
      type: 'report',
      items: [],
      issues: [],
      report: {
        kind: 'injury',
        bodyPart: 'Tobillo derecho',
        recommendations: ['Hielo', 'Sin correr 2 semanas'],
        restTo: '2026-10-26',
      },
    });
  });

  it('un tipo desconocido pasa a informe y uno raro de informe a «other»', () => {
    const output = modelOutputSchema.parse({ type: 'otra', report: { kind: 'raro' } });
    expect(output).toMatchObject({ type: 'report', report: { kind: 'other', diagnosis: null } });
  });
});

describe('buildExtraction: holter', () => {
  it('pasa las medidas a métricas holter.* y marca lo que no está en el texto', () => {
    const e = holter();
    expect(e).toMatchObject({ type: 'holter', start: '2026-09-30T13:30', end: '2026-10-01T12:35' });
    expect(e.items.map((i) => [i.key, i.metric, i.metricValue, i.metricUnit, i.issues])).toEqual([
      ['hr_avg', 'holter.hr_avg', 63, '/min', []],
      ['sdnn', 'holter.sdnn', 174, 'ms', []],
      ['pnn50', 'holter.pnn50', 24, '%', []],
      ['rmssd', 'holter.rmssd', 51, 'ms', ['unverified']],
    ]);
    expect(e.items[0]).toMatchObject({ name: 'FC media', section: 'Holter' });
  });

  it('ordena la tabla por horas, encadena los tramos desde el inicio y la comprueba', () => {
    const e = holter();
    expect(e.hourly).toEqual([
      {
        start: '2026-09-30T13:30',
        end: '2026-09-30T14:00',
        hrMin: 50,
        hrAvg: 67,
        hrMax: 105,
        verified: true,
      },
      {
        start: '2026-09-30T14:00',
        end: '2026-09-30T15:00',
        hrMin: 52,
        hrAvg: 67,
        hrMax: 92,
        verified: true,
      },
    ]);
    const wrong = refreshExtraction(
      { ...e, hourly: [{ ...e.hourly[0], hrAvg: 66 }] },
      redactPersonalData(HOLTER_TEXT).text,
    );
    expect(wrong.hourly[0].verified).toBe(false);
    expect(wrong.issues).toContain('hourly-unverified');
  });
});

describe('comprobaciones contra el texto', () => {
  it('valores con coma o punto y sin confundir 1.4 con 1.41', () => {
    expect(valueInText('5.2', 'Glucosa  5,2 mmol/L')).toBe(true);
    expect(valueInText('1.4', 'Creatinina 1.41')).toBe(false);
    expect(valueInText('41', 'Frec. mín.: 41 lpm')).toBe(true);
    expect(valueInText('Negativo', 'HBsAg NEGATIVO')).toBe(true);
    expect(valueInText('', 'algo')).toBe(false);
  });

  it('fechas en los formatos habituales', () => {
    expect(dateInText('2026-10-07', 'Fecha: 07/10/2026')).toBe(true);
    expect(dateInText('2026-10-07', 'Fecha 7-10-26')).toBe(true);
    expect(dateInText('2026-10-09', 'Madrid, 09 de octubre de 2026')).toBe(true);
    expect(dateInText('2026-10-07', 'Fecha: 17/10/2026')).toBe(false);
  });
});
