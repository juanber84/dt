import { describe, it, expect, vi } from 'vitest';
import { StrengthErrorCode } from '@digitaltwin/strength';
import { createMotraStrengthApp, OWN_TAG, MotraError, MotraErrorCode } from '../src/index.js';

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
        restTime: 120.4,
        measurements: { reps: 12, time: 40, weight: { value: 100, unit: 'kg' } },
      },
      s2: {
        exerciseTypeID: 'barbellDeadlift',
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
      { id: 'MINE', name: 'Pierna bici', numExercises: 1, numSets: 2, estimatedDuration: 70 },
      { id: 'OURS', name: 'Pierna A', caption: 'Antes de la salida', numExercises: 0 },
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
const appWith = (client = fakeClient()) => createMotraStrengthApp({ client, accountId: 'uid-1' });

describe('Motra como app de fuerza', () => {
  it('sin marca y con el límite del plan gratis', () => {
    const app = appWith();
    expect(app).toMatchObject({ id: 'motra', label: 'Fuerza (experimental)', maxTemplates: 2 });
  });

  it('listTemplates: cuáles son de TwinMe por su etiqueta (del detalle)', async () => {
    const list = await appWith().listTemplates();
    expect(list).toEqual([
      { id: 'MINE', name: 'Pierna bici', exercises: 1, sets: 2, minutes: 70, ours: false },
      expect.objectContaining({ id: 'OURS', notes: 'Antes de la salida', ours: true }),
    ]);
  });

  it('getTemplate: ejercicios en orden, series en kg (de libras) y descanso', async () => {
    const t = await appWith().getTemplate('MINE');
    expect(t).toMatchObject({ id: 'MINE', name: 'Pierna bici', ours: false });
    expect(t.exercises).toEqual([
      {
        exerciseId: 'barbellDeadlift',
        name: 'Barbell Deadlift',
        muscles: ['hamstrings'],
        sets: [
          { reps: 12, weightKg: 100, restS: 120 },
          { reps: 10, weightKg: 49.9 },
        ],
      },
    ]);
  });

  it('searchExercises: el id del catálogo de Motra y si es solo de Pro', async () => {
    const client = fakeClient();
    const found = await appWith(client).searchExercises({ query: 'press banca', muscle: 'chest' });
    expect(client.searchExercises).toHaveBeenCalledWith({
      query: 'press banca',
      muscleGroups: 'chest',
      equipmentGroups: undefined,
    });
    expect(found[0]).toEqual({
      exerciseId: 'barbellBenchPress',
      name: 'Barbell Bench Press',
      muscles: ['chest'],
      equipment: ['barbell'],
      metric: 'reps',
    });
    expect(found[1].proOnly).toBe(true);
  });

  it('saveTemplate sin id: una nueva con la etiqueta TwinMe y la cuenta', async () => {
    const client = fakeClient();
    const saved = await appWith(client).saveTemplate({
      name: 'Pierna A',
      notes: 'Antes de la salida',
      exercises: [{ exerciseId: 'barbellBackSquat', sets: [{ reps: 5, weightKg: 80 }] }],
    });
    expect(saved.created).toBe(true);
    const [template, options] = client.saveTemplate.mock.calls[0];
    expect(template).toMatchObject({
      templateID: saved.id,
      userID: 'uid-1',
      name: 'Pierna A',
      caption: 'Antes de la salida',
    });
    expect(Object.values(template.setMap)[0].exerciseTypeID).toBe('barbellBackSquat');
    expect(options).toEqual({ tags: [OWN_TAG] });
  });

  it('saveTemplate con id: reescribe la de TwinMe con el mismo id', async () => {
    const client = fakeClient();
    const saved = await appWith(client).saveTemplate(
      { name: 'Pierna B', exercises: [{ exerciseId: 'legPress', sets: [{ reps: 10 }] }] },
      { templateId: 'OURS' },
    );
    expect(saved).toEqual({ id: 'OURS', created: false });
    expect(client.saveTemplate.mock.calls[0][0].templateID).toBe('OURS');
  });

  it('no reescribe ni borra una del usuario (NOT_OURS)', async () => {
    const client = fakeClient();
    const app = appWith(client);
    const session = { name: 'X', exercises: [{ exerciseId: 'legPress', sets: [{ reps: 1 }] }] };
    await expect(app.saveTemplate(session, { templateId: 'MINE' })).rejects.toMatchObject({
      code: StrengthErrorCode.NOT_OURS,
    });
    await expect(app.deleteTemplate('MINE')).rejects.toMatchObject({
      code: StrengthErrorCode.NOT_OURS,
    });
    expect(client.saveTemplate).not.toHaveBeenCalled();
    expect(client.deleteTemplate).not.toHaveBeenCalled();
  });

  it('deleteTemplate borra la de TwinMe; una que no existe es NOT_FOUND', async () => {
    const client = fakeClient();
    await appWith(client).deleteTemplate('OURS');
    expect(client.deleteTemplate).toHaveBeenCalledWith('OURS');
    await expect(appWith(client).getTemplate('NADA')).rejects.toMatchObject({
      code: StrengthErrorCode.NOT_FOUND,
    });
  });

  it('si Motra rechaza una nueva, LIMIT_REACHED con el límite de 2', async () => {
    const client = fakeClient();
    client.saveTemplate.mockRejectedValue(new MotraError(MotraErrorCode.API_ERROR, 'Motra 403'));
    await expect(
      appWith(client).saveTemplate({
        name: 'X',
        exercises: [{ exerciseId: 'legPress', sets: [{ reps: 1 }] }],
      }),
    ).rejects.toMatchObject({
      code: StrengthErrorCode.LIMIT_REACHED,
      message: expect.stringContaining('caben 2 plantillas'),
    });
  });

  it('sesión caducada: SESSION_EXPIRED pidiendo reconectar', async () => {
    const client = fakeClient();
    client.listTemplates.mockRejectedValue(new MotraError(MotraErrorCode.SESSION_EXPIRED, 'x'));
    await expect(appWith(client).listTemplates()).rejects.toMatchObject({
      code: StrengthErrorCode.SESSION_EXPIRED,
      message: expect.stringContaining('reconectarla'),
    });
  });
});
