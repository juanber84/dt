import { z } from 'zod';
import { StrengthError, setText } from '@digitaltwin/strength';
import { ToolError } from './errors.js';

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
 * Plantillas de las apps de fuerza conectadas (cada una, un adaptador de @digitaltwin/strength):
 * leer las del usuario, buscar en el catálogo de cada app y crear, reescribir o borrar las de
 * TwinMe. Aquí no se sabe nada del formato de cada app.
 *
 * Con una sola app, `app` sobra; con varias, la IA tiene que decir cuál (y preguntarle al usuario
 * si no lo ha dicho). Los exerciseId son de cada app: se buscan en la misma donde se guarda.
 *
 * Cómo se escribe depende de quién la usa:
 * - `direct` (MCP): save_strength_template y delete_strength_template escriben en la app; el
 *   permiso lo pide el cliente (Claude...), que ve que no son de solo lectura.
 * - `propose` (el coach de la app): no escribe. propose_strength_template enseña la sesión en una
 *   tarjeta (`display`) y la guarda el usuario con su botón (POST /coach/messages/:id/apply). Así
 *   no depende de que el modelo pregunte antes.
 *
 * @param {object} deps
 * @param {import('@digitaltwin/strength').StrengthApp[]} deps.apps  las que tiene conectadas
 * @param {'direct'|'propose'} [deps.writes]
 */
export function createStrengthTools({ apps, writes = 'direct' }) {
  if (!apps?.length) return [];
  const names = apps.map((a) => `${a.id} (${a.label})`).join(', ');
  const appParam = z
    .enum(apps.map((a) => a.id))
    .optional()
    .describe(
      apps.length === 1
        ? `App de fuerza; solo tiene ${names}, así que puede omitirse`
        : `App de fuerza: ${names}. Si el usuario no ha dicho en cuál, pregúntaselo`,
    );

  // Lo común de guardar y proponer una sesión (los ejercicios van aparte: proponer pide su nombre)
  const sessionInput = {
    app: appParam,
    templateId: templateId.optional().describe('Para reescribir una de TwinMe; sin él, nueva'),
    name: z.string().trim().min(1).max(80).describe('Nombre que verá en la app ("Pierna A")'),
    notes: z.string().trim().max(200).optional().describe('Descripción corta'),
  };

  const pick = (id) => {
    if (id) return apps.find((a) => a.id === id);
    if (apps.length === 1) return apps[0];
    throw new ToolError(`Tiene varias apps de fuerza (${names}): pregúntale en cuál y pasa app`);
  };
  const run = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof StrengthError) throw new ToolError(err.message);
      throw err;
    }
  };

  const reads = [
    {
      name: 'list_strength_templates',
      title: 'Plantillas de fuerza',
      description:
        'Las plantillas (rutinas) del usuario en sus apps de fuerza: nombre, ejercicios, series, ' +
        'duración estimada y músculos. `ours` = la creó TwinMe (solo esas se pueden reescribir ' +
        'o borrar). `maxTemplates` = cuántas caben en esa app con su plan. Sin `app`, de todas.',
      inputSchema: { app: appParam },
      handler: ({ app } = {}) =>
        run(async () => ({
          apps: await Promise.all(
            (app ? [pick(app)] : apps).map(async (a) => ({
              app: a.id,
              label: a.label,
              ...(a.maxTemplates && { maxTemplates: a.maxTemplates }),
              templates: await a.listTemplates(),
            })),
          ),
        })),
    },

    {
      name: 'get_strength_template',
      title: 'Una plantilla de fuerza, serie a serie',
      description:
        'Una plantilla con sus ejercicios en orden y cada serie ("8x70" = 8 reps con 70 kg, ' +
        '"12" = 12 reps sin peso, "45s" = 45 segundos) y el descanso medio. Sus exerciseId ' +
        'sirven para save_strength_template en la misma app.',
      inputSchema: { app: appParam, templateId },
      handler: ({ app, templateId: id }) =>
        run(async () => {
          const target = pick(app);
          const t = await target.getTemplate(id);
          return {
            app: target.id,
            ...t,
            exercises: t.exercises.map(({ sets, ...exercise }) => {
              const rests = sets.map((s) => s.restS).filter((r) => r > 0);
              return {
                ...exercise,
                sets: sets.map(setText),
                ...(rests.length && {
                  restS: Math.round(rests.reduce((a, b) => a + b, 0) / rests.length),
                }),
              };
            }),
          };
        }),
    },

    {
      name: 'search_exercises',
      title: 'Buscar ejercicios en una app de fuerza',
      description:
        'Busca en el catálogo de ejercicios de una app de fuerza (por nombre, en inglés o ' +
        'español: "bench", "press banca", "sentadilla"; o por músculo y material). Cada app ' +
        'tiene su catálogo y sus ids: busca en la misma app donde vas a guardar. `proOnly` = ' +
        'solo con la suscripción de pago de esa app: no los uses. `metric` = si se apunta por ' +
        'reps o por tiempo.',
      inputSchema: {
        app: appParam,
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
          .describe('Material en inglés: barbell, dumbbells, machine, cables, kettlebell...'),
      },
      handler: ({ app, query = '', muscle, equipment }) =>
        run(async () => {
          const target = pick(app);
          return {
            app: target.id,
            exercises: await target.searchExercises({ query, muscle, equipment }),
          };
        }),
    },
  ];

  const direct = [
    {
      name: 'save_strength_template',
      title: 'Crear o reescribir una plantilla de fuerza',
      description:
        'Crea una plantilla en una app de fuerza del usuario o, con templateId, reescribe entera ' +
        'una de TwinMe (las del usuario no se tocan). Aparece en su app lista para entrenar, ' +
        'marcada como de TwinMe. Los exerciseId tienen que ser de esa app (search_exercises o ' +
        'get_strength_template) y no proOnly; los ejercicios van en el orden dado. Antes de ' +
        'llamarla, enséñale al usuario la sesión y que la confirme. Para ir cambiando la ' +
        'sesión, mejor reescribir la misma plantilla que borrar y crear.',
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      inputSchema: {
        ...sessionInput,
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
      handler: ({ app, templateId: id, name, notes, exercises }) =>
        run(async () => {
          const target = pick(app);
          const saved = await target.saveTemplate(
            { name, notes, exercises },
            id ? { templateId: id } : {},
          );
          return { app: target.id, name, ...saved };
        }),
    },

    {
      name: 'delete_strength_template',
      title: 'Borrar una plantilla de TwinMe',
      description:
        'Borra de una app de fuerza una plantilla creada por TwinMe (las del usuario no). En ' +
        'algunas apps su id no se puede volver a usar.',
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      inputSchema: { app: appParam, templateId },
      handler: ({ app, templateId: id }) =>
        run(async () => {
          const target = pick(app);
          await target.deleteTemplate(id);
          return { app: target.id, deleted: id };
        }),
    },
  ];

  const propose = [
    {
      name: 'propose_strength_template',
      title: 'Proponer una plantilla de fuerza',
      display: 'strength-template',
      description:
        'Enseña al usuario una sesión de fuerza en una tarjeta con un botón para guardarla en su ' +
        'app como plantilla (nueva o, con templateId, reescribiendo una de TwinMe; las suyas no ' +
        'se tocan). No guarda nada: lo hace el usuario con el botón, así que no le preguntes si ' +
        'la guardas ni digas que está guardada. Los exerciseId tienen que ser de esa app ' +
        '(search_exercises o get_strength_template) y no proOnly; `name` es el nombre del ' +
        'ejercicio tal como sale en la app. Los ejercicios van en el orden dado. Para ir ' +
        'cambiando la sesión, mejor reescribir la misma plantilla que crear otra.',
      inputSchema: {
        ...sessionInput,
        exercises: z
          .array(
            z.object({
              exerciseId: z.string().trim().min(2).max(80),
              name: z.string().trim().min(1).max(80).describe('Nombre del ejercicio en la app'),
              sets: z.array(set).min(1).max(10),
            }),
          )
          .min(1)
          .max(15),
      },
      handler: ({ app, templateId: id, name, notes, exercises }) =>
        run(async () => {
          const target = pick(app);
          // Que no se proponga reescribir una del usuario: el botón fallaría después
          const replaces = id ? await target.getTemplate(id) : null;
          if (replaces && !replaces.ours) {
            throw new ToolError(
              'Esa plantilla es del usuario: TwinMe solo reescribe las suyas. Propón una nueva.',
            );
          }
          return {
            display: {
              app: target.id,
              appLabel: target.label,
              ...(id && { templateId: id, replaces: replaces.name }),
              session: { name, ...(notes && { notes }), exercises },
            },
            result: {
              shown: true,
              pending: 'El usuario la guarda (o no) con el botón de la tarjeta',
            },
          };
        }),
    },
  ];

  return [...reads, ...(writes === 'propose' ? propose : direct)];
}
