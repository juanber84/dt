import { StrengthError, StrengthErrorCode } from '@digitaltwin/strength';
import { buildTemplate, MotraError, MotraErrorCode } from './index.js';

export const MOTRA_APP_ID = 'motra';
// El chip que llevan en la app las plantillas que crea TwinMe: solo esas se reescriben o borran
export const OWN_TAG = Object.freeze({ name: 'TwinMe', color: 'orange' });
// Con el plan gratis de la app caben 2 plantillas
const FREE_TEMPLATES = 2;
const LB_TO_KG = 0.45359237;

/**
 * Motra como app de fuerza del contrato de @digitaltwin/strength. Las plantillas de TwinMe se
 * marcan con la etiqueta OWN_TAG, que solo viene en el detalle (no en la lista). Un id borrado no
 * se puede reutilizar, así que para cambiar la sesión se reescribe la misma plantilla.
 * @param {object} deps
 * @param {ReturnType<typeof import('./index.js').createMotraClient>} deps.client
 * @param {string} deps.accountId  uid de la cuenta (va en cada plantilla)
 * @param {string} [deps.label]  integración no oficial: sin la marca
 * @returns {import('@digitaltwin/strength').StrengthApp}
 */
export function createMotraStrengthApp({ client, accountId, label = 'Fuerza (experimental)' }) {
  const isOurs = (template) => (template?.tags ?? []).some((tag) => tag?.name === OWN_TAG.name);

  async function details(id) {
    const template = await call(() => client.templateDetails(id));
    if (!template) throw new StrengthError(StrengthErrorCode.NOT_FOUND, 'No existe esa plantilla');
    return template;
  }

  async function ours(id) {
    const template = await details(id);
    if (!isOurs(template)) {
      throw new StrengthError(
        StrengthErrorCode.NOT_OURS,
        'Esa plantilla es del usuario: TwinMe solo reescribe o borra las que ha creado él',
      );
    }
    return template;
  }

  return {
    id: MOTRA_APP_ID,
    label,
    maxTemplates: FREE_TEMPLATES,

    async listTemplates() {
      const items = await call(() => client.listTemplates());
      // De quién es cada una solo se sabe por el detalle (son pocas: el plan gratis deja 2)
      const full = await Promise.all(
        items.map((t) => call(() => client.templateDetails(t.id)).catch(() => null)),
      );
      return items.map((t, i) => ({
        id: t.id,
        name: t.name,
        ...(t.caption && { notes: t.caption }),
        exercises: t.numExercises,
        sets: t.numSets,
        minutes: t.estimatedDuration,
        muscles: t.primaryMuscleGroups,
        ours: isOurs(full[i]),
      }));
    },

    async getTemplate(id) {
      const t = await details(id);
      return {
        id: t.templateID,
        name: t.name,
        ...(t.caption && { notes: t.caption }),
        ours: isOurs(t),
        exercises: templateExercises(t),
      };
    },

    async searchExercises({ query = '', muscle, equipment } = {}) {
      const items = await call(() =>
        client.searchExercises({ query, muscleGroups: muscle, equipmentGroups: equipment }),
      );
      return items.map((x) => ({
        exerciseId: x.backendKey,
        name: x.presentationName,
        muscles: x.primaryMuscleGroups,
        equipment: x.equipmentGroups,
        metric: x.tracking?.primaryMetric,
        ...(x.isBodyWeight && { bodyweight: true }),
        ...(x.isLocked && { proOnly: true }),
      }));
    },

    async saveTemplate({ name, notes, exercises }, { templateId } = {}) {
      if (templateId) await ours(templateId);
      const template = buildTemplate({
        userId: accountId,
        name,
        caption: notes,
        ...(templateId && { templateId }),
        exercises: exercises.map(({ exerciseId, sets }) => ({ exerciseTypeId: exerciseId, sets })),
      });
      try {
        await call(() => client.saveTemplate(template, { tags: [OWN_TAG] }));
      } catch (err) {
        // Motra no dice por qué rechaza una nueva: lo normal es que ya haya 2 (plan gratis)
        if (templateId || err.code !== StrengthErrorCode.REJECTED) throw err;
        throw new StrengthError(
          StrengthErrorCode.LIMIT_REACHED,
          `${err.message}. Con el plan gratis caben ${FREE_TEMPLATES} plantillas: si ya hay ` +
            `${FREE_TEMPLATES}, hay que liberar una (o reescribir una de TwinMe)`,
        );
      }
      return { id: template.templateID, created: !templateId };
    },

    async deleteTemplate(id) {
      await ours(id);
      await call(() => client.deleteTemplate(id));
    },
  };
}

/** Los errores del cliente, traducidos a los del contrato. */
async function call(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof MotraError)) throw err;
    switch (err.code) {
      case MotraErrorCode.SESSION_EXPIRED:
        throw new StrengthError(
          StrengthErrorCode.SESSION_EXPIRED,
          'La sesión de la app de fuerza ha caducado: hay que reconectarla en Conexiones',
        );
      case MotraErrorCode.NOT_FOUND:
        throw new StrengthError(StrengthErrorCode.NOT_FOUND, 'No existe esa plantilla');
      case MotraErrorCode.RATE_LIMITED:
        throw new StrengthError(
          StrengthErrorCode.RATE_LIMITED,
          'La app de fuerza pide esperar un poco antes de seguir',
        );
      default:
        throw new StrengthError(
          StrengthErrorCode.REJECTED,
          `La app de fuerza no lo ha aceptado (${err.message})`,
        );
    }
  }
}

/** Los ejercicios de una plantilla en orden, con sus series en kg. */
function templateExercises(t) {
  return (t.activities ?? []).flatMap((activity) =>
    (activity.strengthExercise?.exercises ?? []).map(({ setIDs = [] }) => {
      const sets = setIDs.map((sid) => t.setMap?.[sid]).filter(Boolean);
      const typeId = sets[0]?.exerciseTypeID;
      const info = t.exerciseDetails?.[typeId];
      return {
        exerciseId: typeId,
        name: info?.name ?? typeId,
        ...(info?.primaryMuscleGroups?.length && { muscles: info.primaryMuscleGroups }),
        sets: sets.map(({ measurements: m = {}, restTime }) => {
          const kg = m.weight?.unit === 'lb' ? m.weight.value * LB_TO_KG : m.weight?.value;
          return {
            ...(m.reps != null && { reps: m.reps }),
            ...(kg > 0 && { weightKg: Math.round(kg * 10) / 10 }),
            ...(m.time != null && m.reps == null && { timeS: Math.round(m.time) }),
            ...(restTime > 0 && { restS: Math.round(restTime) }),
          };
        }),
      };
    }),
  );
}
