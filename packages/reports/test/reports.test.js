import { describe, it, expect, vi } from 'vitest';
import {
  blockSchema,
  chartPng,
  commentFacts,
  composeDaily,
  createReports,
  formatStat,
  gatherDay,
  longDate,
  renderReportEmail,
  yesterday,
} from '../src/index.js';

const TZ = 'Europe/Madrid';

/** Un día con de todo (lo que devolvería gatherDay). */
function fullDay(overrides = {}) {
  return {
    date: '2026-10-22',
    weight: { last: 81.5, trend: 81.8, bodyFat: 19.9, kgPerWeek: 0.28 },
    targets: { kcal: 1820, proteinG: 150, carbsG: 160, fatG: 65, kgPerWeek: -0.41 },
    intake: { kcal: 1248, proteinG: 70.9, carbsG: 145.4, fatG: 43 },
    fluids: { waterMl: 950, beveragesMl: 200, totalMl: 1150, targetMl: 2500 },
    meals: [
      { time: '07:00', type: 'breakfast', name: 'Bol de avena', kcal: 354, proteinG: 14 },
      { time: '19:40', type: null, name: 'Solomillo <b>', kcal: 140, proteinG: 21 },
    ],
    workouts: [{ time: '18:00', title: 'Rodaje', minutes: 60, km: 28.6, kcal: 600 }],
    sleep: { asleepMinutes: 312, from: '00:44', to: '07:54' },
    steps: 6900,
    symptoms: [{ time: '10:00', text: 'Tos', intensity: 3 }],
    medications: [{ time: '10:00', name: 'Enantyum', dose: '1 comprimido' }],
    weightHistory: [
      { date: '2026-10-20', weight: 81.9, trend: 81.7 },
      { date: '2026-10-21', weight: null, trend: 81.75 },
      { date: '2026-10-22', weight: 81.5, trend: 81.8 },
    ],
    kcalWeek: [
      { date: '2026-10-16', kcal: 490 },
      { date: '2026-10-17', kcal: null },
      { date: '2026-10-18', kcal: 2229 },
      { date: '2026-10-19', kcal: 1462 },
      { date: '2026-10-20', kcal: 1989 },
      { date: '2026-10-21', kcal: 3378 },
      { date: '2026-10-22', kcal: 1248 },
    ],
    ...overrides,
  };
}

const emptyDay = () =>
  fullDay({
    weight: null,
    targets: null,
    intake: { kcal: null, proteinG: null, carbsG: null, fatG: null },
    fluids: { waterMl: null, beveragesMl: null, totalMl: null, targetMl: 2500 },
    meals: [],
    workouts: [],
    sleep: null,
    steps: null,
    symptoms: [],
    medications: [],
    weightHistory: [],
    kcalWeek: fullDay().kcalWeek.map((d) => ({ ...d, kcal: null })),
  });

describe('composeDaily', () => {
  it('un día completo: comentario, cifras frente al objetivo, tablas, gráficas y salud', () => {
    const report = composeDaily(fullDay(), { comment: 'Ayer bien.' });
    expect(report).toMatchObject({
      kind: 'daily',
      title: 'Tu día: jueves 22 de octubre',
      periodFrom: '2026-10-22',
      periodTo: '2026-10-22',
    });
    for (const block of report.blocks) expect(blockSchema.safeParse(block).success).toBe(true);
    expect(report.blocks.map((b) => b.type)).toEqual([
      'text',
      'stats',
      'table',
      'chart',
      'stats',
      'table',
      'chart',
      'callout',
    ]);
    const food = report.blocks[1];
    expect(food.items[0]).toMatchObject({ label: 'Calorías', value: 1248, target: 1820 });
    expect(food.items[4]).toMatchObject({ label: 'Líquidos', value: 1.15, target: 2.5 });
    // Tipo de comida con su nombre; sin tipo, vacío
    expect(report.blocks[2].rows[0]).toEqual(['07:00', 'Desayuno', 'Bol de avena', 354, '14 g']);
    expect(report.blocks[2].rows[1][1]).toBe('');
    // La gráfica de kcal lleva el objetivo; los días sin apuntar, como hueco
    expect(report.blocks[3]).toMatchObject({ kind: 'bar', target: { value: 1820 } });
    expect(report.blocks[3].series[0].values[1]).toBeNull();
    expect(report.blocks[4].items[1].note).toBe('+0,28 kg/semana');
    expect(report.blocks[7].text).toContain('Tos (intensidad 3/5)');
    expect(report.blocks[7].text).toContain('Enantyum, 1 comprimido');
  });

  it('un día sin nada: "sin datos" (nunca ceros inventados) y sin comentario si no lo hay', () => {
    const report = composeDaily(emptyDay());
    expect(report.blocks.some((b) => b.type === 'text')).toBe(false);
    const food = report.blocks.find((b) => b.type === 'stats');
    expect(food.items.every((i) => i.value === null)).toBe(true);
    expect(food.items.map(formatStat)).toEqual(Array(5).fill('sin datos'));
    expect(report.blocks).toContainEqual({
      type: 'callout',
      tone: 'info',
      text: 'No apuntaste ninguna comida.',
    });
    // Sin kcal ni pesos, no hay gráficas vacías
    expect(report.blocks.some((b) => b.type === 'chart')).toBe(false);
  });
});

describe('commentFacts (lo que lee el coach)', () => {
  it('la tendencia dice si sube o baja frente al objetivo, sin signos que interpretar', () => {
    const text = commentFacts(fullDay());
    expect(text).toContain('SUBE 0,28 kg/semana; su objetivo es BAJAR 0,41 kg/semana');
    expect(commentFacts(fullDay({ weight: { ...fullDay().weight, kgPerWeek: -0.3 } }))).toContain(
      'BAJA 0,3 kg/semana',
    );
  });

  it('lo que falta dice "sin apuntar" o "sin datos", nunca 0', () => {
    const text = commentFacts(emptyDay());
    expect(text).toContain('no apuntó nada (no es que no comiera');
    expect(text).toContain('Líquidos: sin apuntar');
    expect(text).toContain('Sueño de anoche: aún sin datos');
    expect(text).toContain('16/10 sin apuntar');
    expect(text).not.toMatch(/\b0 kcal/);
  });

  it('las comidas van con su tipo y la salud al final', () => {
    const text = commentFacts(fullDay());
    expect(text).toContain('07:00 Desayuno: Bol de avena (354 kcal, 14 g proteína)');
    expect(text).toContain('Salud: 10:00 síntoma: Tos (3/5); 10:00 medicación: Enantyum');
  });
});

describe('renderReportEmail', () => {
  it('las gráficas van incrustadas (cid) como PNG; el HTML escapa y enlaza al informe', () => {
    const report = { ...composeDaily(fullDay(), { comment: 'Hola <tú>' }), id: 'r1' };
    const mail = renderReportEmail(report, {
      appUrl: 'https://twinme.app',
      reportUrl: 'https://twinme.app/reports/r1',
    });
    expect(mail.subject).toBe('Tu día: jueves 22 de octubre');
    expect(mail.attachments.map((a) => a.contentId)).toEqual(['chart-1', 'chart-2']);
    for (const a of mail.attachments) {
      expect(mail.html).toContain(`src="cid:${a.contentId}"`);
      // Firma de un PNG
      expect([...a.content.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
    expect(mail.html).toContain('Hola &lt;tú&gt;');
    expect(mail.html).toContain('Solomillo &lt;b&gt;');
    expect(mail.html).toContain('https://twinme.app/reports/r1');
    expect(mail.text).toContain('- Calorías: 1248 / 1820 kcal');
    expect(mail.text).toContain('[Gráfica: Calorías, últimos 7 días]');
  });
});

describe('chartPng', () => {
  it('pinta una línea con huecos y una sola fecha sin romperse', () => {
    const png = chartPng({
      title: 'Peso',
      bucket: 'day',
      kind: 'line',
      labels: ['2026-10-22'],
      series: [{ label: 'Peso', unit: 'kg', values: [81.5] }],
    });
    expect(png.length).toBeGreaterThan(1000);
  });
});

describe('gatherDay', () => {
  it('suma el día desde la BD y el motor, en el día local del usuario', async () => {
    // Medianoche del 22 en Madrid = 21 a las 22:00 UTC
    const midnight = '2026-10-21T22:00:00.000Z';
    const queries = {
      episodes: vi.fn(async ({ kinds }) =>
        kinds.includes('sleep')
          ? [
              {
                kind: 'sleep',
                start: '2026-10-22T22:44:00Z',
                end: '2026-10-23T05:54:00Z',
                summary: { asleepMinutes: 312 },
              },
            ]
          : [
              {
                kind: 'meal',
                start: '2026-10-22T05:00:00Z',
                title: 'Avena',
                summary: { kcal: 354, proteinG: 14, mealType: 'breakfast' },
              },
              {
                kind: 'workout',
                start: '2026-10-22T16:00:00Z',
                title: 'Rodaje',
                summary: { durationS: 5400, distanceM: 28600, kcal: 600 },
              },
            ],
      ),
      series: vi.fn(async ({ metrics }) =>
        metrics.length === 1
          ? { 'intake.energy': { points: [{ t: midnight, value: 1248 }] } }
          : {
              'intake.energy': { points: [{ t: midnight, value: 1248 }] },
              'intake.water': { points: [{ t: midnight, value: 950 }] },
            },
      ),
    };
    const engine = {
      state: async () => ({
        ready: true,
        weight: { last: 81.5, trend: 81.8, bodyFat: 19.9 },
        expenditure: { trendKgPerWeek: 0.28 },
        targets: { kcal: 1820 },
        trend: [],
      }),
    };
    const day = await gatherDay({
      userId: 'u1',
      date: '2026-10-22',
      now: new Date('2026-10-23T08:00:00Z'),
      queries,
      engine,
      timeZone: TZ,
    });

    expect(queries.episodes.mock.calls[0][0]).toMatchObject({
      from: new Date(midnight),
      to: new Date('2026-10-22T22:00:00.000Z'),
    });
    expect(day.meals).toEqual([
      { time: '07:00', type: 'breakfast', name: 'Avena', kcal: 354, proteinG: 14 },
    ]);
    expect(day.workouts[0]).toMatchObject({ minutes: 90, km: 28.6 });
    // 1,5 h de entreno: 2,5 L + 0,75 L, redondeado a 100 ml
    expect(day.fluids).toEqual({
      waterMl: 950,
      beveragesMl: null,
      totalMl: 950,
      targetMl: 3300,
    });
    expect(day.sleep).toEqual({ asleepMinutes: 312, from: '00:44', to: '07:54' });
    expect(day.intake.proteinG).toBeNull();
    expect(day.weight.kgPerWeek).toBe(0.28);
    expect(day.kcalWeek.at(-1)).toEqual({ date: '2026-10-22', kcal: 1248 });
    expect(day.kcalWeek[0]).toEqual({ date: '2026-10-16', kcal: null });
  });
});

describe('fechas', () => {
  it('ayer en la zona del usuario y el día largo sin coma', () => {
    // 23:30 UTC del 22 ya es día 23 en Madrid
    expect(yesterday(new Date('2026-10-22T23:30:00Z'), TZ)).toBe('2026-10-22');
    expect(longDate('2026-10-22')).toBe('jueves 22 de octubre');
  });
});

describe('createReports.runDaily', () => {
  const setup = ({ clock = '2026-10-23T06:00:00Z', settings, exists = false, comment } = {}) => {
    const saved = [];
    const store = {
      recipients: async () => [
        {
          userId: 'u1',
          email: 'yo@example.com',
          name: 'Juan',
          dailyEnabled: true,
          dailyTime: '07:30',
          ...settings,
        },
      ],
      dailyExists: vi.fn(async () => exists),
      save: vi.fn(async (_userId, report) => {
        const stored = { ...report, id: 'r1' };
        saved.push(stored);
        return stored;
      }),
    };
    const emptyQueries = { episodes: async () => [], series: async () => ({}) };
    const email = { send: vi.fn(async () => ({ status: 'sent', id: 'em_1' })) };
    const chat = {
      complete:
        comment ??
        vi.fn(async () => ({ message: { content: 'Ayer bien.' }, usage: null, model: 'm' })),
    };
    const reports = createReports({
      store,
      queries: emptyQueries,
      engine: { state: async () => ({ ready: false }) },
      chat,
      email,
      appUrl: 'https://twinme.app',
      timeZone: TZ,
      now: () => new Date(clock),
    });
    return { reports, store, email, saved };
  };

  it('pasada su hora: hace el de ayer, lo guarda y lo manda una vez (dedupe por día)', async () => {
    // 06:00 UTC = 08:00 en Madrid
    const { reports, email, saved } = setup();
    const result = await reports.runDaily();
    expect(result).toEqual({
      date: '2026-10-22',
      done: [{ userId: 'u1', reportId: 'r1', email: 'sent' }],
    });
    expect(saved[0].blocks[0]).toEqual({ type: 'text', text: 'Ayer bien.' });
    expect(email.send).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        kind: 'daily-report',
        to: 'yo@example.com',
        dedupeKey: '2026-10-22',
        subject: 'Tu día: jueves 22 de octubre',
      }),
    );
  });

  it('antes de su hora, apagado o ya hecho: nada', async () => {
    // 05:00 UTC = 07:00 en Madrid, antes de las 07:30
    expect((await setup({ clock: '2026-10-23T05:00:00Z' }).reports.runDaily()).done).toEqual([]);
    expect((await setup({ settings: { dailyEnabled: false } }).reports.runDaily()).done).toEqual(
      [],
    );
    const { reports, store } = setup({ exists: true });
    expect((await reports.runDaily()).done).toEqual([]);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('si el LLM falla, el informe sale igual (sin comentario)', async () => {
    const { reports, saved } = setup({
      comment: async () => {
        throw new Error('DeepSeek 503');
      },
    });
    expect((await reports.runDaily()).done[0]).toMatchObject({ email: 'sent' });
    expect(saved[0].blocks.some((b) => b.type === 'text')).toBe(false);
  });
});
