const SEX = { male: 'hombre', female: 'mujer' };

/**
 * Lo que el coach tiene que saber SIEMPRE antes de contestar (no depende de que se acuerde de
 * mirarlo): quién es la persona y cómo está de salud estos días. Texto corto para el prompt.
 *
 * @param {object} input
 * @param {{ age?: number|null, sex?: string|null, heightCm?: number|null, weightGoalKg?: number|null }} [input.profile]
 * @param {Array<{ kind: string, start: string, title: string, summary?: object }>} [input.health]
 *   Notas, síntomas y tomas de medicación de los últimos días (episodios del timeline).
 * @param {string} input.timeZone
 */
export function buildContext({ profile = {}, health = [], timeZone }) {
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
