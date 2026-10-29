import { describe, it, expect, vi } from 'vitest';
import { MotraError, MotraErrorCode } from '@digitaltwin/motra';
import { createTools, ToolError } from '../src/tools.js';
import { OWN_TAG } from '../src/strength-tools.js';

const base = { queries: {}, userId: 'u1', timeZone: 'Europe/Madrid' };

// Dos plantillas: una del usuario (sin etiqueta) y una de TwinMe
const templates = {
  MINE: {
    templateID: 'MINE',
    name: 'Pierna bici',
    tags: [],
    activities: [{ strengthExercise: { exercises: [{ setIDs: ['s1', 's2'] }] } }],
    setMap: {
      s1: {
        exerciseTypeID: 'barbellDeadlift',
        restTime: 120,
        measurements: { reps: 12, weight: { value: 100, unit: 'kg' } },
      },
      s2: {
        exerciseTypeID: 'barbellDeadlift',
        restTime: 180,
        measurements: { reps: 10, weight: { value: 110, unit: 'lb' } },
      },
    },
    exerciseDetails: {
      barbellDeadlift: { name: 'Barbell Deadlift', primaryMuscleGroups: ['hamstrings'] },
    },
  },
  OURS: { templateID: 'OURS', name: 'Pierna A', tags: [OWN_TAG], activities: [], setMap: {} },
};

function fakeClient() {
  return {
    listTemplates: vi.fn(async () => [
      { id: 'MINE', name: 'Pierna bici', numExercises: 1, numSets: 2 },
      { id: 'OURS', name: 'Pierna A', numExercises: 0, numSets: 0 },
    ]),
    templateDetails: vi.fn(async (id) => {
      if (!templates[id]) throw new MotraError(MotraErrorCode.NOT_FOUND, 'Motra 404');
      return templates[id];
    }),
    saveTemplate: vi.fn(async (t) => t.templateID),
    deleteTemplate: vi.fn(async () => {}),
    searchExercises: vi.fn(async () => [
      {
        backendKey: 'barbellBenchPress',
        presentationName: 'Barbell Bench Press',
        primaryMuscleGroups: ['chest'],
        equipmentGroups: ['barbell'],
        tracking: { primaryMetric: 'reps' },
        isLocked: false,
      },
      { backendKey: 'dumbbellAlternatingBenchPress', presentationName: 'Alt', isLocked: true },
    ]),
  };
}

const tools = (client) =>
  Object.fromEntries(
    createTools({ ...base, strength: { client, accountId: 'uid-1' } }).map((t) => [t.name, t]),
  );

describe('plantillas de fuerza', () => {
  it('sin la app de fuerza conectada no hay herramientas de plantillas', () => {
    const names = createTools(base).map((t) => t.name);
    expect(names).not.toContain('save_strength_template');
    expect(names).not.toContain('search_exercises');
  });

  it('las que escriben no van como solo lectura', () => {
    const t = tools(fakeClient());
    expect(t.save_strength_template.annotations).toMatchObject({ readOnlyHint: false });
    expect(t.delete_strength_template.annotations).toMatchObject({ destructiveHint: true });
    expect(t.list_strength_templates.annotations).toBeUndefined();
  });

  it('list: dice cuáles son de TwinMe mirando su etiqueta', async () => {
    const out = await tools(fakeClient()).list_strength_templates.handler({});
    expect(out.templates.map(({ id, ours }) => ({ id, ours }))).toEqual([
      { id: 'MINE', ours: false },
      { id: 'OURS', ours: true },
    ]);
  });

  it('get: los ejercicios en orden y las series en corto (libras a kg)', async () => {
    const out = await tools(fakeClient()).get_strength_template.handler({ templateId: 'MINE' });
    expect(out.exercises).toEqual([
      {
        exerciseId: 'barbellDeadlift',
        name: 'Barbell Deadlift',
        muscles: ['hamstrings'],
        sets: ['12x100', '10x49.9'],
        restS: 150,
      },
    ]);
  });

  it('search: el exerciseId y si es solo de pago', async () => {
    const out = await tools(fakeClient()).search_exercises.handler({ query: 'press banca' });
    expect(out.exercises[0]).toMatchObject({ exerciseId: 'barbellBenchPress', metric: 'reps' });
    expect(out.exercises[0].proOnly).toBeUndefined();
    expect(out.exercises[1].proOnly).toBe(true);
  });

  it('save sin id: crea una nueva con la etiqueta TwinMe y la cuenta del usuario', async () => {
    const client = fakeClient();
    const out = await tools(client).save_strength_template.handler({
      name: 'Pierna A',
      notes: 'Antes de la salida larga',
      exercises: [
        { exerciseId: 'barbellBackSquat', sets: [{ reps: 5, weightKg: 80, restS: 180 }] },
      ],
    });
    expect(out).toMatchObject({ name: 'Pierna A', created: true });
    const [template, options] = client.saveTemplate.mock.calls[0];
    expect(template).toMatchObject({
      templateID: out.id,
      userID: 'uid-1',
      caption: 'Antes de la salida larga',
    });
    expect(options).toEqual({ tags: [OWN_TAG] });
  });

  it('save con id: reescribe la de TwinMe con el mismo id', async () => {
    const client = fakeClient();
    const out = await tools(client).save_strength_template.handler({
      templateId: 'OURS',
      name: 'Pierna B',
      exercises: [{ exerciseId: 'legPress', sets: [{ reps: 10, weightKg: 120 }] }],
    });
    expect(out).toEqual({ id: 'OURS', name: 'Pierna B', created: false });
    expect(client.saveTemplate.mock.calls[0][0].templateID).toBe('OURS');
  });

  it('no reescribe ni borra una plantilla del usuario', async () => {
    const client = fakeClient();
    const t = tools(client);
    await expect(
      t.save_strength_template.handler({
        templateId: 'MINE',
        name: 'X',
        exercises: [{ exerciseId: 'legPress', sets: [{ reps: 10 }] }],
      }),
    ).rejects.toThrow(/es del usuario/);
    await expect(t.delete_strength_template.handler({ templateId: 'MINE' })).rejects.toBeInstanceOf(
      ToolError,
    );
    expect(client.saveTemplate).not.toHaveBeenCalled();
    expect(client.deleteTemplate).not.toHaveBeenCalled();
  });

  it('delete: borra la de TwinMe', async () => {
    const client = fakeClient();
    expect(await tools(client).delete_strength_template.handler({ templateId: 'OURS' })).toEqual({
      deleted: 'OURS',
    });
    expect(client.deleteTemplate).toHaveBeenCalledWith('OURS');
  });

  it('si la app no acepta una nueva, avisa del límite de 2 del plan gratis', async () => {
    const client = fakeClient();
    client.saveTemplate.mockRejectedValue(new MotraError(MotraErrorCode.API_ERROR, 'Motra 403'));
    await expect(
      tools(client).save_strength_template.handler({
        name: 'Pierna A',
        exercises: [{ exerciseId: 'legPress', sets: [{ reps: 10 }] }],
      }),
    ).rejects.toThrow(/caben 2 plantillas/);
  });

  it('sesión caducada: pide reconectar', async () => {
    const client = fakeClient();
    client.listTemplates.mockRejectedValue(
      new MotraError(MotraErrorCode.SESSION_EXPIRED, 'caducada'),
    );
    await expect(tools(client).list_strength_templates.handler({})).rejects.toThrow(/reconectarla/);
  });
});
