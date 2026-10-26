/**
 * Suplementos habituales (creatina, magnesio...): qué toma cada persona y desde cuándo. Las tomas
 * van aparte, como episodios `supplement` del timeline.
 *
 * La creatina retiene agua en el músculo: al empezar el peso sube 1-2 kg en 3-4 semanas (sin fase
 * de carga) y al dejarla baja igual. El motor no lo corrige (la tendencia lo absorbe como
 * cualquier cambio); solo avisa, para que nadie lo lea como grasa ni recorte comida por ello.
 */

export const SUPPLEMENT_TYPES = Object.freeze([
  'creatine',
  'magnesium',
  'vitamin_d',
  'omega_3',
  'other',
]);
export const SUPPLEMENT_TIMINGS = Object.freeze([
  'morning',
  'midday',
  'evening',
  'night',
  'training',
]);

/** Días en los que el agua de la creatina aún se está moviendo, al empezar o al dejarla. */
export const CREATINE_WATER_DAYS = 28;

const DAY_MS = 24 * 3600 * 1000;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

/**
 * El aviso de la creatina en `today`: empezada ('starting') o dejada ('stopping') hace menos de
 * CREATINE_WATER_DAYS, con desde cuándo. Si hay varias, la más reciente. null si no toca.
 * @param {Array<{ type: string, name: string, startedOn: string, stoppedOn?: string|null }>} supplements
 * @param {string} today  YYYY-MM-DD local
 * @returns {{ phase: 'starting'|'stopping', name: string, since: string, daysSince: number } | null}
 */
export function creatineNotice(supplements = [], today) {
  const recent = (date) => date <= today && daysBetween(date, today) < CREATINE_WATER_DAYS;
  const notices = supplements
    .filter((s) => s.type === 'creatine')
    .flatMap((s) => {
      if (s.stoppedOn && s.stoppedOn <= today) {
        // Dejada: solo si llegó a tomarla lo bastante para cargar agua (empezar y dejar es nada)
        const loaded = daysBetween(s.startedOn, s.stoppedOn) >= 7;
        return loaded && recent(s.stoppedOn)
          ? [{ phase: 'stopping', name: s.name, since: s.stoppedOn }]
          : [];
      }
      return recent(s.startedOn) ? [{ phase: 'starting', name: s.name, since: s.startedOn }] : [];
    })
    .sort((a, b) => b.since.localeCompare(a.since));
  const notice = notices[0];
  return notice ? { ...notice, daysSince: daysBetween(notice.since, today) } : null;
}

/**
 * El aviso dicho para la persona (Hoy y el informe): "Empezaste la creatina el 20/10: …".
 * @param {ReturnType<typeof creatineNotice>} notice
 */
export function creatinePhrase(notice) {
  if (!notice) return '';
  const [, month, day] = notice.since.split('-').map(Number);
  const when = `el ${day}/${month}`;
  return notice.phase === 'starting'
    ? `Empezaste la creatina ${when}: las primeras 3-4 semanas el peso sube 1-2 kg de agua en el músculo. No es grasa: no recortes comida por eso.`
    : `Dejaste la creatina ${when}: en unas semanas el peso baja 1-2 kg de agua. No es grasa perdida.`;
}

const fromRow = (row) => ({
  id: row.id,
  name: row.name,
  type: row.type,
  dose: row.dose,
  timing: row.timing,
  startedOn: isoDate(row.started_on),
  stoppedOn: row.stopped_on ? isoDate(row.stopped_on) : null,
});
// postgres devuelve las columnas date como Date a medianoche UTC
const isoDate = (value) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

/**
 * La lista de cada usuario en la BD.
 * @param {{ db: import('postgres').Sql }} deps
 */
export function createSupplements({ db }) {
  return {
    /** Todos: los que toma (por momento del día y nombre) y después los que dejó. */
    async list(userId) {
      const rows = await db`
        select * from supplements where user_id = ${userId}
        order by stopped_on is not null, stopped_on desc,
          array_position(${SUPPLEMENT_TIMINGS}::text[], timing) nulls last, name
      `;
      return rows.map(fromRow);
    },

    /** @param {{ name, type?, dose?, timing?, startedOn, stoppedOn? }} input */
    async create(userId, input) {
      const [row] = await db`
        insert into supplements (user_id, name, type, dose, timing, started_on, stopped_on)
        values (${userId}, ${input.name}, ${input.type ?? 'other'}, ${input.dose ?? null},
          ${input.timing ?? null}, ${input.startedOn}, ${input.stoppedOn ?? null})
        returning *
      `;
      return fromRow(row);
    },

    /** Cambia lo que venga en `patch` (null borra dosis, momento o fecha de dejarlo). null si no es suyo. */
    async update(userId, id, patch) {
      const columns = {
        name: 'name',
        type: 'type',
        dose: 'dose',
        timing: 'timing',
        startedOn: 'started_on',
        stoppedOn: 'stopped_on',
      };
      const set = Object.fromEntries(
        Object.entries(columns)
          .filter(([field]) => field in patch)
          .map(([field, column]) => [column, patch[field]]),
      );
      if (!Object.keys(set).length) return this.get(userId, id);
      const [row] = await db`
        update supplements set ${db(set)}, updated_at = now()
        where id = ${id} and user_id = ${userId}
        returning *
      `;
      return row ? fromRow(row) : null;
    },

    async get(userId, id) {
      const [row] = await db`select * from supplements where id = ${id} and user_id = ${userId}`;
      return row ? fromRow(row) : null;
    },

    /** Lo borra de la lista (las tomas ya apuntadas se quedan). false si no era suyo. */
    async remove(userId, id) {
      const rows = await db`
        delete from supplements where id = ${id} and user_id = ${userId} returning id
      `;
      return rows.length > 0;
    },
  };
}
