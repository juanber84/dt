import { describe, it, expect } from 'vitest';
import {
  ANALYTES,
  CLINICAL_METRICS,
  findAnalyte,
  getAnalyte,
  normalizeName,
  normalizeUnit,
  toAnalyteUnit,
} from '../src/analytes.js';

describe('findAnalyte', () => {
  it.each([
    ['Volumen corpuscular medio (VCM)', 'lab.mcv'],
    ['Conc. Hemoglobina Corpuscular Media (CHCM)', 'lab.mchc'],
    ['% Neutrófilos', 'lab.neutrophils_pct'],
    ['# Neutrófilos', 'lab.neutrophils'],
    ['Filtrado Glomerular Estimado (CKD-EPI creatinina 2009)', 'lab.egfr'],
    ['Indice COL. total / HDL-COL', 'lab.cholesterol_hdl_ratio'],
    ['Índice LDL-COL / HDL COL', 'lab.ldl_hdl_ratio'],
    ['ASAT (GOT)', 'lab.ast'],
    ['Ácido Fólico (vitamina B9)', 'lab.folate'],
    ['Lipoproteína (a)', 'lab.lipoprotein_a'],
    ['HDL Colesterol', 'lab.cholesterol_hdl'],
    ['Colesterol No-HDL', 'lab.cholesterol_non_hdl'],
    ['GLUCOSA BASAL', 'lab.glucose'],
  ])('%s → %s', (name, code) => {
    expect(findAnalyte(name)?.code).toBe(code);
  });

  it('no se inventa lo que no conoce', () => {
    expect(findAnalyte('Antígeno raro')).toBeNull();
  });

  it('los nombres confirmados por el usuario mandan', () => {
    const aliases = new Map([[normalizeName('Antígeno raro'), 'lab.custom.antigeno_raro']]);
    expect(findAnalyte('ANTÍGENO RARO', aliases)).toEqual({
      code: 'lab.custom.antigeno_raro',
      custom: true,
    });
    expect(findAnalyte('Glucosa', new Map([['glucosa', 'lab.hba1c']])).code).toBe('lab.hba1c');
  });

  it('cada alias lleva a un solo parámetro y los códigos no se repiten', () => {
    const codes = ANALYTES.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    const metricCodes = CLINICAL_METRICS.map((m) => m.code);
    expect(new Set(metricCodes).size).toBe(metricCodes.length);
  });
});

describe('unidades', () => {
  it.each([
    ['mg/dl', 'mg/dL'],
    ['UI/l', 'U/L'],
    ['10e6/µL', '10*6/uL'],
    ['10e3/μL', '10*3/uL'],
    ['ml/min/1.73m^2', 'mL/min/{1.73_m2}'],
    ['lpm', '/min'],
    ['furlongs', null],
  ])('%s → %s', (raw, ucum) => {
    expect(normalizeUnit(raw)).toBe(ucum);
  });

  it('convierte a la unidad del parámetro', () => {
    expect(toAnalyteUnit(getAnalyte('lab.glucose'), 5.2, 'mmol/L')).toEqual({
      value: 93.6832,
      unit: 'mg/dL',
    });
    expect(toAnalyteUnit(getAnalyte('lab.creatinine'), 1.41, 'mg/dl')).toEqual({
      value: 1.41,
      unit: 'mg/dL',
    });
    expect(toAnalyteUnit(getAnalyte('lab.cholesterol_hdl_ratio'), 3.1, null)).toEqual({
      value: 3.1,
      unit: '1',
    });
  });

  it('sin conversión conocida no adivina', () => {
    expect(toAnalyteUnit(getAnalyte('lab.hba1c'), 42, 'mmol/mol')).toBeNull();
  });
});
