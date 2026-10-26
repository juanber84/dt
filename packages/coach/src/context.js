import { periodPhrase } from '@digitaltwin/engine';

const SEX = { male: 'hombre', female: 'mujer' };

/**
 * Lo que el coach tiene que saber SIEMPRE antes de contestar (no depende de que se acuerde de
 * mirarlo): quién es la persona y cómo está de salud estos días. Texto corto para el prompt.
 *
 * @param {object} input
 * @param {{ age?: number|null, sex?: string|null, heightCm?: number|null, weightGoalKg?: number|null }} [input.profile]
 * @param {Array<{ kind: string, start: string, title: string, summary?: object }>} [input.health]
 *   Notas, síntomas y tomas de medicación de los últimos días (episodios del timeline).
 * @param {object} [input.engine]  Estado del motor (@digitaltwin/engine computeState)
 * @param {Array<{ id, name, dose?, timing?, startedOn, stoppedOn? }>} [input.supplements]
 *   Los habituales (Ajustes). Sus tomas van en `health` (kind `supplement`).
 * @param {string} input.timeZone
 */
export function buildContext({ profile = {}, health = [], engine, supplements = [], timeZone }) {
  const lines = [];

  const who = [
    profile.sex && SEX[profile.sex],
    profile.age != null && `${profile.age} años`,
    profile.heightCm && `${profile.heightCm} cm`,
  ].filter(Boolean);
  lines.push(
    who.length
      ? `Persona: ${who.join(', ')}.${profile.weightGoalKg ? ` Peso objetivo: ${profile.weightGoalKg} kg.` : ''}`
      : 'Persona: no ha rellenado su edad, sexo ni altura (Ajustes → Cuenta). Si hace falta para responder, pídeselo.',
  );

  const at = (iso) =>
    new Intl.DateTimeFormat('es-ES', {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));

  const notes = health.filter((e) => e.kind === 'note');
  const symptoms = health.filter((e) => e.kind === 'symptom');
  const meds = health.filter((e) => e.kind === 'medication');

  lines.push(...engineLines(engine));
  lines.push(
    ...supplementLines(
      supplements,
      health.filter((e) => e.kind === 'supplement'),
      timeZone,
    ),
  );

  if (!notes.length && !symptoms.length && !meds.length) {
    lines.push('Salud estos días: nada apuntado (ni síntomas, ni notas, ni medicación).');
    return lines.join('\n');
  }

  lines.push('Salud de los últimos 14 días (lo ha apuntado él; tenlo en cuenta en TODO consejo):');
  for (const n of notes) lines.push(`- Nota (${at(n.start)}): ${n.title}`);
  for (const s of symptoms) {
    const intensity = s.summary?.intensity ? ` ${s.summary.intensity}/5` : '';
    lines.push(`- Síntoma (${at(s.start)}): ${s.title}${intensity}`);
  }
  // La medicación, agrupada: cuántas tomas, desde cuándo y la última
  const byName = new Map();
  for (const m of meds) {
    const list = byName.get(m.title) ?? [];
    list.push(m);
    byName.set(m.title, list);
  }
  for (const [name, list] of byName) {
    const dose = list.at(-1).summary?.dose;
    lines.push(
      `- Medicación: ${name}${dose ? ` (${dose})` : ''}: ${list.length} tomas, ` +
        `desde ${at(list[0].start)}, la última ${at(list.at(-1).start)}`,
    );
  }
  return lines.join('\n');
}

const TIMING = {
  morning: 'por la mañana',
  midday: 'a mediodía',
  evening: 'por la tarde',
  night: 'por la noche',
  training: 'con el entreno',
};
const shortDate = (iso) => iso.split('-').reverse().join('/');

/**
 * Los suplementos que toma (y los que ha dejado hace poco), con cuántos días los ha marcado de los
 * últimos 14: si marca pocos puede que no los apunte, no que no los tome.
 */
function supplementLines(supplements, taken, timeZone) {
  const localDay = (time) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(time));
  const today = localDay(Date.now());
  const daysSince = (date) => Math.round((Date.parse(today) - Date.parse(date)) / DAY_MS);
  const current = supplements.filter((s) => !s.stoppedOn || s.stoppedOn > today);
  const stopped = supplements.filter(
    (s) => s.stoppedOn && s.stoppedOn <= today && daysSince(s.stoppedOn) < 60,
  );
  if (!current.length && !stopped.length) return [];
  const marked = (s) =>
    new Set(taken.filter((t) => t.summary?.supplementId === s.id).map((t) => localDay(t.start)))
      .size;
  const lines = ['Suplementos (su lista de Ajustes; las tomas las marca en Hoy):'];
  for (const s of current) {
    const how = [s.dose, TIMING[s.timing]].filter(Boolean).join(', ');
    // De los últimos 14 días, o de los que lleva si empezó hace menos
    const out = Math.max(1, Math.min(14, daysSince(s.startedOn) + 1));
    const count = marked(s);
    const record =
      out === 1
        ? count
          ? 'marcado hoy'
          : 'sin marcar hoy'
        : `marcado ${count} de los últimos ${out} días`;
    lines.push(
      `- ${s.name}${how ? ` (${how})` : ''}, desde el ${shortDate(s.startedOn)}: ${record}.`,
    );
  }
  for (const s of stopped) lines.push(`- Dejó ${s.name} el ${shortDate(s.stoppedOn)}.`);
  return lines;
}

const DAY_MS = 24 * 3600 * 1000;
const ago = (days) => (days === 0 ? 'hoy' : `hace ${days} ${days === 1 ? 'día' : 'días'}`);

const CONFIDENCE = {
  none: 'aún sin días suficientes: es una estimación por fórmula',
  low: 'con muy pocos días apuntados, todavía orientativo',
  medium: 'con unas semanas de datos, bastante fiable',
  high: 'con datos de sobra, fiable',
};

/**
 * Las cifras calculadas por la app (@digitaltwin/engine), en pocas líneas: son las buenas y el
 * coach no calcula otras. Van como hechos sobre la persona: el "motor" es cosa interna.
 */
function engineLines(engine) {
  if (!engine?.ready) return [];
  const e = engine.expenditure;
  const t = engine.targets;
  const fat = engine.weight.bodyFat ? `, grasa ${engine.weight.bodyFat} %` : '';
  const eating = e.intakeAvg
    ? `, come de media ${e.intakeAvg} kcal y su peso real cambia ${e.trendKgPerWeek} kg/semana`
    : '';
  const lines = [
    `Peso real (tendencia, sin el agua de cada día): ${engine.weight.trend} kg (último pesaje ${engine.weight.last} kg${fat}).`,
    `Gasto real: ${e.kcal} kcal/día, ${CONFIDENCE[e.confidence]}; ${e.loggedDays} días con la comida apuntada entera${eating}.`,
    `Objetivo diario (ritmo ${engine.weeklyRatePct} % del peso por semana = ${t.kgPerWeek} kg/semana): ${t.kcal} kcal, proteína ${t.proteinG} g, grasa ${t.fatG} g, hidratos ${t.carbsG} g.`,
  ];
  const p = engine.period;
  const where = { away: 'fuera de casa', sick: 'enfermo', other: 'en un periodo especial' };
  if (p?.phase === 'during') {
    lines.push(
      `Ahora está ${where[p.type] ?? where.other} (${periodPhrase(p)}): el objetivo de arriba ya es de mantenimiento y el motor no aprende de estos días. No le metas prisa con el déficit ni le reproches no pesarse o no apuntarlo todo; si apunta, mejor días enteros a ojo que a medias.`,
    );
  } else if (p?.phase === 'settling') {
    lines.push(
      `Volvió hace ${p.daysSince} ${p.daysSince === 1 ? 'día' : 'días'} (${where[p.type] ?? where.other}, ${periodPhrase(p)}): si el peso ha subido es sobre todo agua y sal, se va en 3-5 días; la tendencia ya lo tiene en cuenta. Que no recorte comida para compensar.`,
    );
  }
  const c = engine.creatine;
  if (c?.phase === 'starting') {
    lines.push(
      `Empezó a tomar creatina (${c.name}) ${ago(c.daysSince)}: las primeras 3-4 semanas el peso sube 1-2 kg de agua en el músculo, no grasa (la tendencia lo recoge como subida). Si habla de peso, explícaselo; que no recorte comida por eso.`,
    );
  } else if (c?.phase === 'stopping') {
    lines.push(
      `Dejó la creatina (${c.name}) ${ago(c.daysSince)}: en unas semanas el peso baja 1-2 kg de agua, que no es grasa perdida. Si habla de peso, que no lo cuente como progreso.`,
    );
  }
  if (e.mismatch) {
    lines.push(
      'Tras semanas apuntando, lo apuntado no cuadra con su peso (según lo apuntado come poco y no baja): o se escapa comida al apuntar o el peso va con agua. Sácalo solo si habla de peso o comida, una vez, con tacto; no le recomiendes comer menos por eso.',
    );
  }
  return lines;
}
