import { z } from 'zod';
import { buildTemplate, MotraError, MotraErrorCode } from '@digitaltwin/motra';
import { ToolError } from './errors.js';

// El chip que llevan en la app las plantillas que crea TwinMe: solo esas se reescriben o borran
export const OWN_TAG = Object.freeze({ name: 'TwinMe', color: 'orange' });
const LB_TO_KG = 0.45359237;

const templateId = z.string().trim().min(8).max(64).describe('id de list_strength_templates');
const set = z
  .object({
    reps: z.number().int().min(1).max(100).optional(),
    weightKg: z
      .number()
      .min(0)
      .max(500)
      .optional()
      .describe('Kilos de la serie; 0 o nada = sin peso'),
    timeS: z.number().int().min(1).max(3600).optional().describe('Segundos (plancha...)'),
    restS: z.number().int().min(0).max(900).optional().describe('Descanso después, en segundos'),
  })
  .refine((s) => s.reps != null || s.timeS != null, 'Cada serie lleva reps o timeS');

/**
 * Plantillas de la app de fuerza (la conexión experimental): leer las del usuario, buscar en el
 * catálogo de ejercicios y crear, reescribir o borrar las de TwinMe. Las del usuario no se tocan:
 * lo que no lleva la etiqueta OWN_TAG es suyo. La etiqueta solo viene en el detalle, no en la
 * lista.
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/motra').createMotraClient>} deps.client
 * @param {string} deps.accountId  uid de la cuenta en la app (va en cada plantilla)
 */
export function createStrengthTools({ client, accountId }) {
  const call = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof MotraError)) throw err;
      if (err.code === MotraErrorCode.SESSION_EXPIRED) {
        throw new ToolError(
          'La sesión de la app de fuerza ha caducado: el usuario tiene que reconectarla en Conexiones',
        );
      }
      if (err.code === MotraErrorCode.NOT_FOUND) throw new ToolError('No existe esa plantilla');
      if (err.code === MotraErrorCode.RATE_LIMITED) {
        throw new ToolError('La app de fuerza pide esperar un poco antes de seguir');
      }
      throw new ToolError(`La app de fuerza no lo ha aceptado (${err.message})`);
    }
  };
  const isOurs = (template) => (template?.tags ?? []).some((tag) => tag?.name === OWN_TAG.name);

  async function ours(id) {
    const template = await call(() => client.templateDetails(id));
    if (!template) throw new ToolError('No existe esa plantilla');
    if (!isOurs(template)) {
      throw new ToolError(
        'Esa plantilla es del usuario: TwinMe solo reescribe o borra las que ha creado él. ' +
          'Crea una nueva o pídele al usuario que libere una.',
      );
    }
    return template;
  }

  return [
    {
      name: 'list_strength_templates',
      title: 'Plantillas de fuerza',
      description:
        'Las plantillas (rutinas) del usuario en su app de fuerza: nombre, ejercicios, series, ' +
        'duración estimada y músculos. `ours` = la creó TwinMe (lleva su etiqueta; solo esas se ' +
        'pueden reescribir o borrar). Con el plan gratis de la app caben 2 plantillas en total.',
      inputSchema: {},
      handler: async () => {
        const items = await call(() => client.listTemplates());
        // De quién es cada una solo se sabe por el detalle (son pocas: el plan gratis deja 2)
        const details = await Promise.all(
          items.map((t) => call(() => client.templateDetails(t.id)).catch(() => null)),
        );
        return {
          templates: items.map((t, i) => ({
            id: t.id,
            name: t.name,
            ...(t.caption && { caption: t.caption }),
            exercises: t.numExercises,
            sets: t.numSets,
            minutes: t.estimatedDuration,
            muscles: t.primaryMuscleGroups,
            ours: isOurs(details[i]),
          })),
        };
      },
    },

    {
      name: 'get_strength_template',
      title: 'Una plantilla de fuerza, serie a serie',
      description:
        'Una plantilla con sus ejercicios en orden y cada serie ("8x70" = 8 reps con 70 kg, ' +
        '"12" = 12 reps sin peso, "45s" = 45 segundos) y el descanso medio. Los exerciseId sirven ' +
        'para save_strength_template.',
      inputSchema: { templateId },
      handler: async ({ templateId: id }) => {
        const t = await call(() => client.templateDetails(id));
        if (!t) throw new ToolError('No existe esa plantilla');
        return {
          id: t.templateID,
          name: t.name,
          ...(t.caption && { caption: t.caption }),
          ours: isOurs(t),
          exercises: templateExercises(t),
        };
      },
    },

    {
      name: 'search_exercises',
      title: 'Buscar ejercicios',
      description:
        'Busca en el catálogo de ejercicios de la app de fuerza (por nombre, en inglés o español: ' +
        '"bench", "press banca", "sentadilla"). Devuelve el exerciseId que hay que usar en ' +
        'save_strength_template. `proOnly` = solo con la suscripción de pago: evítalos. ' +
        '`metric` = si se apunta por reps o por tiempo.',
      inputSchema: {
        query: z.string().trim().max(60).default('').describe('Parte del nombre'),
        muscle: z
          .string()
          .trim()
          .max(30)
          .optional()
          .describe(
            'Grupo muscular en inglés: chest, quads, glutes, hamstrings, lats, biceps, abs...',
          ),
        equipment: z
          .string()
          .trim()
          .max(30)
          .optional()
          .describe('Material en inglés: barbell, dumbbell, machine, cables, kettlebell...'),
      },
      handler: async ({ query = '', muscle, equipment }) => {
        const items = await call(() =>
          client.searchExercises({ query, muscleGroups: muscle, equipmentGroups: equipment }),
        );
        return {
          exercises: items.map((x) => ({
            exerciseId: x.backendKey,
            name: x.presentationName,
            muscles: x.primaryMuscleGroups,
            equipment: x.equipmentGroups,
            metric: x.tracking?.primaryMetric,
            ...(x.isBodyWeight && { bodyweight: true }),
            ...(x.isLocked && { proOnly: true }),
          })),
        };
      },
    },

    {
      name: 'save_strength_template',
      title: 'Crear o reescribir una plantilla de fuerza',
      description:
        'Crea una plantilla en la app de fuerza del usuario o, con templateId, reescribe entera ' +
        'una de TwinMe (las del usuario no se tocan). Aparece en su app lista para entrenar, con ' +
        'la etiqueta TwinMe. ' +
        'Usa exerciseId de search_exercises o get_strength_template; los ejercicios van en el ' +
        'orden dado. Antes de llamarla, enséñale al usuario la sesión y que la confirme. Para ' +
        'ir cambiando la sesión, mejor reescribir la misma plantilla que borrar y crear.',
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      inputSchema: {
        templateId: templateId.optional().describe('Para reescribir una de TwinMe; sin él, nueva'),
        name: z.string().trim().min(1).max(80).describe('Nombre que verá en la app ("Pierna A")'),
        notes: z.string().trim().max(200).optional().describe('Descripción corta'),
        exercises: z
          .array(
            z.object({
              exerciseId: z.string().trim().min(2).max(80),
              sets: z.array(set).min(1).max(10),
            }),
          )
          .min(1)
          .max(15),
      },
      handler: async ({ templateId: id, name, notes, exercises }) => {
        if (id) await ours(id);
        const template = buildTemplate({
          userId: accountId,
          name,
          caption: notes,
          ...(id && { templateId: id }),
          exercises: exercises.map(({ exerciseId, sets }) => ({
            exerciseTypeId: exerciseId,
            sets,
          })),
        });
        try {
          await call(() => client.saveTemplate(template, { tags: [OWN_TAG] }));
        } catch (err) {
          if (id || !(err instanceof ToolError)) throw err;
          throw new ToolError(
            `${err.message}. Con el plan gratis de la app caben 2 plantillas: si ya hay 2, el ` +
              'usuario tiene que liberar una (o reescribe una de TwinMe).',
          );
        }
        return { id: template.templateID, name, created: !id };
      },
    },

    {
      name: 'delete_strength_template',
      title: 'Borrar una plantilla de TwinMe',
      description:
        'Borra de la app de fuerza una plantilla creada por TwinMe (las del usuario no). Su id ' +
        'no se puede volver a usar.',
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      inputSchema: { templateId },
      handler: async ({ templateId: id }) => {
        await ours(id);
        await call(() => client.deleteTemplate(id));
        return { deleted: id };
      },
    },
  ];
}

/** Los ejercicios de una plantilla en orden, con sus series en corto. */
function templateExercises(t) {
  return (t.activities ?? []).flatMap((activity) =>
    (activity.strengthExercise?.exercises ?? []).map(({ setIDs = [] }) => {
      const sets = setIDs.map((sid) => t.setMap?.[sid]).filter(Boolean);
      const typeId = sets[0]?.exerciseTypeID;
      const info = t.exerciseDetails?.[typeId];
      const rests = sets.map((s) => s.restTime).filter((r) => r > 0);
      return {
        exerciseId: typeId,
        name: info?.name ?? typeId,
        ...(info?.primaryMuscleGroups?.length && { muscles: info.primaryMuscleGroups }),
        sets: sets.map(({ measurements: m = {} }) => {
          const kg = m.weight?.unit === 'lb' ? m.weight.value * LB_TO_KG : (m.weight?.value ?? 0);
          const weight = kg > 0 ? `x${Math.round(kg * 10) / 10}` : '';
          if (m.reps != null) return `${m.reps}${weight}`;
          if (m.time != null) return `${Math.round(m.time)}s${weight && ` ${weight}`}`;
          return '?';
        }),
        ...(rests.length && {
          restS: Math.round(rests.reduce((a, b) => a + b, 0) / rests.length),
        }),
      };
    }),
  );
}
