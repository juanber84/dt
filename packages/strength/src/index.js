/**
 * Contrato común de las apps de fuerza (Motra, Hevy...). Cada app es un adaptador con las mismas
 * operaciones y en el mismo formato; quien lo usa (el MCP) no sabe nada del formato de cada una.
 * No hay catálogo de ejercicios propio: cada app busca en el suyo y sus ids solo valen en ella
 * (la IA elige la app y traduce entre catálogos por el nombre).
 *
 * Cada adaptador marca a su manera las plantillas que crea TwinMe (`ours`) y solo reescribe o
 * borra esas: las del usuario no se tocan.
 *
 * @typedef {{ reps?: number, weightKg?: number, timeS?: number, restS?: number }} StrengthSet
 *
 * @typedef {object} StrengthTemplateSummary
 * @property {string} id
 * @property {string} name
 * @property {string} [notes]
 * @property {number} [exercises]  cuántos ejercicios
 * @property {number} [sets]  cuántas series en total
 * @property {number} [minutes]  duración estimada
 * @property {string[]} [muscles]
 * @property {boolean} ours  la creó TwinMe
 *
 * @typedef {object} StrengthTemplate
 * @property {string} id
 * @property {string} name
 * @property {string} [notes]
 * @property {boolean} ours
 * @property {{ exerciseId: string, name: string, muscles?: string[], sets: StrengthSet[] }[]} exercises
 *
 * @typedef {object} StrengthExercise
 * @property {string} exerciseId  id en el catálogo de esa app
 * @property {string} name
 * @property {string[]} [muscles]
 * @property {string[]} [equipment]
 * @property {'reps'|'time'|'distance'} [metric]  cómo se apunta
 * @property {boolean} [bodyweight]
 * @property {boolean} [proOnly]  solo con la suscripción de pago de la app
 *
 * @typedef {object} StrengthSession  lo que se guarda: ejercicios en orden con sus series
 * @property {string} name
 * @property {string} [notes]
 * @property {{ exerciseId: string, sets: StrengthSet[] }[]} exercises
 *
 * @typedef {object} StrengthApp
 * @property {string} id  'motra', 'hevy'...
 * @property {string} label  cómo se le llama al usuario (sin marcas si la integración no es oficial)
 * @property {number} [maxTemplates]  plantillas que caben (con el plan gratis), si hay límite
 * @property {() => Promise<StrengthTemplateSummary[]>} listTemplates
 * @property {(id: string) => Promise<StrengthTemplate>} getTemplate
 * @property {(filters: { query?: string, muscle?: string, equipment?: string }) => Promise<StrengthExercise[]>} searchExercises
 * @property {(session: StrengthSession, options?: { templateId?: string }) => Promise<{ id: string, created: boolean }>} saveTemplate
 *   Sin templateId, una nueva; con él, reescribe entera una de TwinMe.
 * @property {(id: string) => Promise<void>} deleteTemplate  solo las de TwinMe
 */

export const StrengthErrorCode = Object.freeze({
  /** No existe esa plantilla */
  NOT_FOUND: 'NOT_FOUND',
  /** Es del usuario, no de TwinMe: no se reescribe ni se borra */
  NOT_OURS: 'NOT_OURS',
  /** No caben más plantillas (plan gratis) */
  LIMIT_REACHED: 'LIMIT_REACHED',
  /** Hay que volver a conectar la app */
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  /** La app no lo ha aceptado (ejercicio que no existe, formato...) */
  REJECTED: 'REJECTED',
});

/** Error de una app de fuerza con un mensaje que se le puede contar al usuario (o a su IA). */
export class StrengthError extends Error {
  /**
   * @param {keyof typeof StrengthErrorCode} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'StrengthError';
    this.code = code;
  }
}

/** Una serie en corto: "8x70" (reps x kg), "12" (sin peso), "45s" o "45s x10" (por tiempo). */
export function setText({ reps, weightKg, timeS } = {}) {
  const kg = weightKg > 0 ? `x${Math.round(weightKg * 10) / 10}` : '';
  if (reps != null) return `${reps}${kg}`;
  if (timeS != null) return `${Math.round(timeS)}s${kg && ` ${kg}`}`;
  return '?';
}
