// Textos como los que saca `pdftotext -layout` de los informes, con datos inventados

export const LAB_TEXT = `                                                          Laboratorio Hospital de Pruebas
                                                          C/ Falsa 123, 28000 Madrid

                                                                                 Nº Laboratorio:   11112222
                                                                                 Fecha:            07/10/2026
Datos del paciente
Sexo:                    VARON                            Nombre:                PEREZ GOMEZ, PEDRO
Edad:                    01/02/1980 (46 años)             Nº Historia:           99887766
D.N.I./Pasaporte:        12345678Z                        Garante:               ASEGURADORA, S.A.
Nº Póliza:               111122223333444455556666         Centro:                CENTRO MÉDICO
Servicio solicitante:    Analisis Clinicos                Peticionario:          LOPEZ RUIZ, ANA

Comentario de informe:

                                               HEMOGRAMA - SERIE ROJA
 Prueba                             Resultado                 Unidades      Rango de Referencia
Hemoglobina                         14.5                     g/dL           (12.1 - 18.0)
Volumen corpuscular medio (VCM)     89.5                     fL             (78.9 - 101.0)

                                               BIOQUIMICA BASICA
 Prueba                                    Resultado               Unidades Rango de Referencia
Glucosa                                   5,2                     mmol/L      (4.1 - 5.6)
Creatinina                                1.41                    mg/dl       (0.6 - 1.3)                                      *
HDL Colesterol                            42                      mg/dl       (Sup. 40)
Antígeno raro                             12.0                    U/mL        (Inf. 35)
Hepatitis B (HBsAg)                       Negativo

                                                              Madrid, 09 de octubre de 2026 15:25
                                                              Directora técnica: Dra. Laura Martínez Sánchez`;

export const HOLTER_TEXT = `Nombre de su hospital                                           Dirección Línea 1
                                                          Informe de ECG con Holter
Paciente:PEREZ GOMEZ , PEDRO NHC :99887766
Fecha de nacimiento:                 01/02/1980       Informe nro.:      000123    Hora de inicio:   13:30 D1
Edad/Sexo:                         46/ Masculino      Fecha de prueba:   30/09/2026
Frecuencia prom.:        63
VARIABILIDAD FRECUENCIA CARDIACA
SDNN: 174 SDNN5:           82 PNN50:         24
     HORA                    FREC. CARD. TOTAL
TERMINANDO       BAJA       MEDIA ALTA LATIDOS
   14:00 D1          50             67   105   1921
   15:00 D1          52             67    92   4021
    Resumen:         41             63   106   87315
Interpretación:
Ritmo sinusal.
Informe nro.: 000123      PEREZ GOMEZ , PEDRO NHC :99887766      Fecha de prueba:: 30/09/2026   PÁGINA 2`;

/** Lo que devolvería el modelo para LAB_TEXT. */
export const LAB_OUTPUT = {
  type: 'lab',
  title: 'Analítica',
  center: 'Laboratorio Hospital de Pruebas',
  date: '2026-10-07',
  start: null,
  end: null,
  summary: '',
  items: [
    item('Hemograma - Serie roja', 'Hemoglobina', '14.5', 14.5, 'g/dL', '(12.1 - 18.0)', 12.1, 18),
    item(
      'Hemograma - Serie roja',
      'Volumen corpuscular medio (VCM)',
      '89.5',
      89.5,
      'fL',
      '(78.9 - 101.0)',
      78.9,
      101,
    ),
    item('Bioquímica básica', 'Glucosa', '5,2', 5.2, 'mmol/L', '(4.1 - 5.6)', 4.1, 5.6),
    item('Bioquímica básica', 'Creatinina', '1.41', 1.41, 'mg/dl', '(0.6 - 1.3)', 0.6, 1.3, 'high'),
    item('Bioquímica básica', 'HDL Colesterol', '42', 42, 'mg/dl', '(Sup. 40)', 40, null),
    item('Bioquímica básica', 'Antígeno raro', '12.0', 12, 'U/mL', '(Inf. 35)', null, 35),
    item('Bioquímica básica', 'Hepatitis B (HBsAg)', 'Negativo', null, null, null, null, null),
  ],
  measures: [],
  hourly: [],
};

export const HOLTER_OUTPUT = {
  type: 'holter',
  title: 'Holter ECG 24 h',
  center: null,
  date: '2026-09-30',
  start: '2026-09-30T13:30',
  end: '2026-10-01T12:35',
  summary: 'Ritmo sinusal.',
  items: [],
  measures: [
    { key: 'hr_avg', name: 'Frecuencia prom.', value_text: '63', value: 63, unit: 'lpm' },
    { key: 'sdnn', name: 'SDNN', value_text: '174', value: 174, unit: 'ms' },
    { key: 'pnn50', name: 'PNN50', value_text: '24', value: 24, unit: null },
    // Inventado: no está en el texto
    { key: 'rmssd', name: 'RMSSD', value_text: '51', value: 51, unit: 'ms' },
  ],
  hourly: [
    { end: '2026-09-30T15:00', hr_min: 52, hr_avg: 67, hr_max: 92 },
    { end: '2026-09-30T14:00', hr_min: 50, hr_avg: 67, hr_max: 105 },
  ],
};

function item(section, name, valueText, value, unit, rangeText, min, max, flag = null) {
  return {
    section,
    name,
    value_text: valueText,
    value,
    unit,
    range_text: rangeText,
    range_min: min,
    range_max: max,
    flag,
    comment: '',
  };
}
