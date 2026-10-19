import { describe, expect, it } from 'vitest';
import {
  SKIP,
  bySection,
  categoryOf,
  chooseMetric,
  clinicalOverview,
  countsText,
  documentIssues,
  editItem,
  gaugeGeometry,
  parameterGroups,
  historyCells,
  movedFrom,
  fmtUnit,
  metricChoice,
  metricGroups,
  needsLook,
  parseRange,
  parseValue,
  rangeText,
  statusPill,
  uploadProblem,
} from '../src/services/clinical.js';
import {
  byDay,
  clinicalEvent,
  documentDay,
  documentEvent,
  emptySummary,
  mergeDay,
  withDocuments,
} from '../src/services/timeline.js';

const item = (over = {}) => ({
  id: 'i1',
  section: 'Bioquímica',
  name: 'Creatinina',
  text: '1.41',
  value: 1.41,
  unit: 'mg/dl',
  rangeText: '(0.6 - 1.3)',
  rangeMin: 0.6,
  rangeMax: 1.3,
  flag: 'high',
  metric: 'lab.creatinine',
  skip: false,
  issues: [],
  ...over,
});

describe('editar valores', () => {
  it.each([
    ['1,41', 1.41],
    ['79', 79],
    [' -2.5 ', -2.5],
    ['<0,5', null],
    ['Negativo', null],
    ['', null],
  ])('parseValue(%j) → %j', (text, value) => {
    expect(parseValue(text)).toBe(value);
  });

  it.each([
    ['(0.6 - 1.3)', { min: 0.6, max: 1.3 }],
    ['3,81 – 5,81', { min: 3.81, max: 5.81 }],
    ['(Inf. 200)', { min: null, max: 200 }],
    ['< 125', { min: null, max: 125 }],
    ['(Sup. 40)', { min: 40, max: null }],
    ['> 3,5', { min: 3.5, max: null }],
    ['(Ver comentario)', { min: null, max: null }],
  ])('parseRange(%j)', (text, range) => {
    expect(parseRange(text)).toEqual(range);
  });

  it('un resultado nuevo actualiza el número y deja el "fuera de rango" para la API', () => {
    expect(editItem(item(), { text: '1,2' })).toMatchObject({
      text: '1,2',
      value: 1.2,
      flag: null,
    });
    expect(editItem(item(), { rangeText: 'Inf. 2' })).toMatchObject({
      rangeMin: null,
      rangeMax: 2,
    });
    expect(editItem(item(), { unit: 'mg/dL' })).toMatchObject({ unit: 'mg/dL', flag: 'high' });
  });

  it('el desplegable de métrica: automática, no guardar o una concreta', () => {
    expect(metricChoice(item())).toBe('lab.creatinine');
    expect(metricChoice(item({ metric: null }))).toBe('');
    const skipped = chooseMetric(item(), SKIP);
    expect(skipped).toMatchObject({ skip: true, metric: 'lab.creatinine' });
    expect(metricChoice(skipped)).toBe(SKIP);
    expect(chooseMetric(skipped, 'lab.urea')).toMatchObject({ skip: false, metric: 'lab.urea' });
    expect(chooseMetric(item(), '')).toMatchObject({ metric: null });
  });

  it('solo piden mirar los avisos que importan', () => {
    expect(needsLook(item({ issues: ['unverified'] }))).toBe(true);
    expect(needsLook(item({ issues: ['unit'] }))).toBe(true);
    expect(needsLook(item({ issues: ['unknown', 'qualitative'] }))).toBe(false);
  });
});

describe('textos', () => {
  it('estado y recuento de un documento', () => {
    expect(statusPill('review')).toEqual({ tone: 'warning', label: 'Por revisar' });
    expect(statusPill('confirmed').tone).toBe('good');
    expect(countsText({ items: 50, flagged: 1, issues: 0 })).toBe('50 valores · 1 fuera de rango');
    expect(countsText({ items: 1, flagged: 0, issues: 2 })).toBe('1 valor · 2 con aviso');
    expect(countsText({ items: 0 })).toBe('');
  });

  it('rangos y unidades legibles', () => {
    expect(rangeText({ rangeMin: 0.6, rangeMax: 1.3 })).toBe('0,6 – 1,3');
    expect(rangeText({ rangeMin: null, rangeMax: 200 })).toBe('< 200');
    expect(rangeText({ rangeMin: 40, rangeMax: null })).toBe('> 40');
    expect(rangeText({ rangeText: '(Ver comentario)' })).toBe('(Ver comentario)');
    expect(fmtUnit('10*3/uL')).toBe('10³/µL');
    expect(fmtUnit('1')).toBe('');
  });

  it('agrupa por sección respetando el orden del informe', () => {
    const groups = bySection([
      item({ id: 'a', section: 'Hemograma' }),
      item({ id: 'b', section: 'Bioquímica' }),
      item({ id: 'c', section: 'Hemograma' }),
    ]);
    expect(groups.map((g) => [g.section, g.items.map((i) => i.id)])).toEqual([
      ['Hemograma', ['a', 'c']],
      ['Bioquímica', ['b']],
    ]);
    expect(
      metricGroups([
        { code: 'a', section: 'X' },
        { code: 'b', section: 'Y' },
        { code: 'c', section: 'X' },
      ]).map((g) => [g.section, g.options.length]),
    ).toEqual([
      ['X', 2],
      ['Y', 1],
    ]);
  });

  it('antes de subir: solo PDFs y de 15 MB como mucho', () => {
    expect(uploadProblem({ name: 'a.pdf', type: 'application/pdf', size: 1000 })).toBeNull();
    expect(uploadProblem({ name: 'A.PDF', type: '', size: 1000 })).toBeNull();
    expect(uploadProblem({ name: 'foto.jpg', type: 'image/jpeg', size: 1000 })).toMatch(/PDF/);
    expect(uploadProblem({ name: 'a.pdf', type: 'application/pdf', size: 20e6 })).toMatch(/15 MB/);
  });
});

describe('informes en el timeline del día', () => {
  const local = (h, m = 0, d = 7) => new Date(2026, 9, d, h, m).toISOString();
  const lab = {
    id: 'e1',
    kind: 'lab',
    start: local(8),
    end: null,
    title: 'Analítica',
    provider: 'clinical',
    summary: {
      documentId: 'doc-1',
      items: 50,
      flagged: 1,
      flaggedItems: [{ name: 'Creatinina', text: '1.41', unit: 'mg/dl', flag: 'high' }],
    },
  };

  it('una analítica: lo fuera de rango, y se abre en el lateral', () => {
    expect(clinicalEvent(lab)).toMatchObject({
      category: 'clinical',
      icon: 'FlaskConical',
      title: 'Analítica',
      subtitle: '50 valores · 1 fuera de rango',
      start: 8 * 60,
      metrics: [{ label: '↑ Creatinina', value: 1.41, unit: 'mg/dl', digits: 2 }],
      id: 'clinical-doc-1',
      clinical: { documentId: 'doc-1', status: 'confirmed' },
      sources: [{ source: 'clinical', externalId: 'doc-1' }],
    });
  });

  it('un holter: sus medidas y la duración', () => {
    const event = clinicalEvent({
      ...lab,
      kind: 'holter',
      title: 'Holter',
      start: new Date(2026, 8, 30, 13, 30).toISOString(),
      end: new Date(2026, 9, 1, 12, 35).toISOString(),
      summary: {
        documentId: 'doc-2',
        measures: { hr_min: 41, hr_avg: 63, hr_max: 106, sdnn: 174 },
      },
    });
    expect(event).toMatchObject({
      icon: 'HeartPulse',
      start: 13 * 60 + 30,
      end: 13 * 60 + 30 + 1385,
    });
    expect(event.metrics.map((m) => [m.label, m.value])).toEqual([
      ['FC mín.', 41],
      ['FC media', 63],
      ['FC máx.', 106],
      ['SDNN', 174],
    ]);
  });

  it('entra en el día como un evento más', () => {
    const day = emptySummary('2026-10-07');
    const merged = mergeDay(day, {
      episodes: byDay([lab]),
      daily: new Map(),
      stepsByHour: Array(24).fill(0),
      hr: [],
    });
    expect(merged.events.filter((e) => e.category === 'clinical')).toHaveLength(1);
  });
});

describe('documentos de Clínica en el día', () => {
  const doc = (over = {}) => ({
    id: 'd1',
    status: 'confirmed',
    type: 'lab',
    title: 'Analítica',
    center: 'Lab',
    date: '2026-10-07',
    requestedDate: '2026-10-19',
    start: null,
    end: null,
    counts: { items: 50, flagged: 1, issues: 0 },
    flaggedItems: [{ name: 'Creatinina', text: '1.41', unit: 'mg/dl', flag: 'high' }],
    measures: {},
    diagnosis: null,
    restTo: null,
    fileName: 'a.pdf',
    createdAt: new Date(2026, 9, 19, 10, 15).toISOString(),
    ...over,
  });

  it('va al día de la prueba; sin fecha, al de la subida', () => {
    expect(documentDay(doc())).toBe('2026-10-07');
    expect(documentDay(doc({ date: null }))).toBe('2026-10-19');
    expect(documentDay(doc({ date: null, requestedDate: null }))).toBe('2026-10-19');
    expect(movedFrom(doc())).toBe('2026-10-19');
    expect(movedFrom(doc({ requestedDate: '2026-10-07' }))).toBeNull();
  });

  it('confirmado: como el episodio; pendiente: con su estado y a la hora de subida', () => {
    expect(documentEvent(doc())).toMatchObject({
      id: 'clinical-d1',
      start: 8 * 60,
      subtitle: '50 valores · 1 fuera de rango',
      clinical: { documentId: 'd1', status: 'confirmed' },
    });
    const reading = documentEvent(
      doc({ status: 'processing', type: null, title: null, date: null, counts: { items: 0 } }),
    );
    expect(reading).toMatchObject({
      title: 'Informe',
      subtitle: 'Leyendo el informe…',
      start: 10 * 60 + 15,
      metrics: [],
      clinical: { status: 'processing' },
    });
    expect(documentEvent(doc({ status: 'review' })).subtitle).toBe(
      'Por revisar: confirma lo leído',
    );
  });

  it('un informe: su diagnóstico y el reposo', () => {
    const e = documentEvent(
      doc({ type: 'report', title: 'Traumatología', diagnosis: 'Esguince', restTo: '2026-10-26' }),
    );
    expect(e).toMatchObject({
      icon: 'ClipboardList',
      subtitle: 'Esguince · reposo hasta el 26 oct',
    });
  });

  it('los documentos sustituyen a sus episodios y solo salen en su día', () => {
    const episode = { id: 'clinical-d1', start: 480, title: 'viejo' };
    const other = { id: 'meal-1', start: 600 };
    const events = withDocuments([episode, other], [doc()], '2026-10-07');
    expect(events.map((e) => [e.id, e.title])).toEqual([
      ['clinical-d1', 'Analítica'],
      ['meal-1', undefined],
    ]);
    expect(withDocuments([other], [doc()], '2026-10-19').map((e) => e.id)).toEqual(['meal-1']);
  });

  it('la fecha que no está en el informe y es la de la subida se explica así', () => {
    const extraction = { date: '2026-10-19', issues: ['date-unverified'] };
    expect(documentIssues(extraction, '2026-10-19')).toEqual(['date-from-upload']);
    expect(documentIssues(extraction, '2026-10-18')).toEqual(['date-unverified']);
  });
});

describe('vista de Clínica', () => {
  const docs = [
    { id: 'a', status: 'confirmed', type: 'lab', date: '2026-09-28', counts: { flagged: 0 } },
    {
      id: 'b',
      status: 'confirmed',
      type: 'lab',
      date: '2026-10-07',
      counts: { items: 3, flagged: 1 },
    },
    { id: 'h', status: 'confirmed', type: 'holter', date: '2026-09-30', measures: { hr_avg: 63 } },
    { id: 'r', status: 'review', type: 'report', date: '2026-10-12' },
  ];
  const point = (documentId, value, flag = null) => ({
    documentId,
    value,
    rangeMin: 0.6,
    rangeMax: 1.3,
    flag,
  });
  const params = [
    {
      code: 'glu',
      name: 'Glucosa',
      points: [point('a', 90), point('b', 95)],
      latest: { flag: null },
    },
    {
      code: 'cre',
      name: 'Creatinina',
      points: [point('a', 1.2), point('b', 1.41, 'high')],
      latest: { flag: 'high' },
    },
    { code: 'hdl', name: 'HDL', points: [point('b', 42)], latest: { flag: null } },
    {
      code: 'hr',
      name: 'FC media',
      points: [point('h', 63), point('h', 61)],
      latest: { flag: null },
    },
  ];

  it('tres categorías', () => {
    expect(['lab', 'ecg', 'imaging', 'report'].map(categoryOf)).toEqual([
      'analysis',
      'test',
      'test',
      'report',
    ]);
  });

  it('resumen: lo confirmado, lo fuera de rango ahora y lo pendiente', () => {
    const o = clinicalOverview(docs, params);
    expect(o).toMatchObject({ labs: 2, tests: 1, reports: 0, pending: 1 });
    expect(o.lastLab.id).toBe('b');
    expect(o.flaggedNow.map((p) => p.code)).toEqual(['cre']);
  });

  it('valores: todos, por sección y categoría, con la medida anterior', () => {
    const withSection = params.map((p, i) => ({
      ...p,
      section: i < 3 ? 'Bioquímica' : 'Holter',
      latest: { ...p.latest, value: p.points.at(-1).value },
    }));
    const groups = parameterGroups(withSection, docs);
    expect(groups.map((g) => [g.section, g.items.map((p) => p.code)])).toEqual([
      ['Bioquímica', ['glu', 'cre', 'hdl']],
      ['Holter', ['hr']],
    ]);
    expect(groups[0].items[0]).toMatchObject({ trend: [90, 95], delta: 5 });
    expect(groups[0].items[2]).toMatchObject({ trend: null, previous: null, delta: null });
    expect(parameterGroups(withSection, docs, 'test').map((g) => g.section)).toEqual(['Holter']);
  });

  it('barra de rango: el rango sombreado y el punto en su sitio', () => {
    expect(gaugeGeometry(15, 10, 20)).toEqual({ band: [25, 75], marker: 50 });
    // Fuera de rango por arriba: el eje se estira hasta el valor
    expect(gaugeGeometry(40, 10, 20).marker).toBe(100);
    // "Inf. 200": de 0 al máximo
    expect(gaugeGeometry(150, null, 200)).toEqual({ band: [0, 66.7], marker: 50 });
    // "Sup. 40": del mínimo al final
    expect(gaugeGeometry(60, 40, null)).toEqual({ band: [50, 100], marker: 75 });
    expect(gaugeGeometry(null, 1, 2)).toBeNull();
    expect(gaugeGeometry(5, null, null)).toBeNull();
  });

  it('historial: cifras según la categoría', () => {
    expect(historyCells(docs[1])).toEqual([
      { label: 'Valores', value: '3' },
      { label: 'Fuera de rango', value: '1', alert: true },
    ]);
    expect(historyCells(docs[2])).toEqual([{ label: 'FC media', value: '63 ppm' }]);
    expect(historyCells(docs[3])).toEqual([]);
  });
});
