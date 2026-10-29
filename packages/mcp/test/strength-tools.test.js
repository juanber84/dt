import { describe, it, expect, vi } from 'vitest';
import { StrengthError, StrengthErrorCode } from '@digitaltwin/strength';
import { createTools, ToolError } from '../src/tools.js';

const base = { queries: {}, userId: 'u1', timeZone: 'Europe/Madrid' };

/** Una app de fuerza de mentira que cumple el contrato. */
function fakeApp(id, label = id) {
  return {
    id,
    label,
    maxTemplates: 2,
    listTemplates: vi.fn(async () => [{ id: `${id}-T1`, name: 'Pierna', ours: false }]),
    getTemplate: vi.fn(async (templateId) => ({
      id: templateId,
      name: 'Pierna',
      ours: true,
      exercises: [
        {
          exerciseId: 'squat',
          name: 'Back Squat',
          sets: [
            { reps: 5, weightKg: 80, restS: 120 },
            { reps: 5, weightKg: 80, restS: 180 },
          ],
        },
        { exerciseId: 'plank', name: 'Plank', sets: [{ timeS: 45 }] },
      ],
    })),
    searchExercises: vi.fn(async () => [{ exerciseId: `${id}-bench`, name: 'Bench Press' }]),
    saveTemplate: vi.fn(async (_session, { templateId } = {}) => ({
      id: templateId ?? `${id}-NEW`,
      created: !templateId,
    })),
    deleteTemplate: vi.fn(async () => {}),
  };
}

const toolsFor = (apps) =>
  Object.fromEntries(createTools({ ...base, strength: { apps } }).map((t) => [t.name, t]));

const session = { name: 'Pierna A', exercises: [{ exerciseId: 'squat', sets: [{ reps: 5 }] }] };

describe('herramientas de plantillas de fuerza', () => {
  it('sin apps de fuerza no hay herramientas de plantillas', () => {
    for (const deps of [base, { ...base, strength: { apps: [] } }]) {
      const names = createTools(deps).map((t) => t.name);
      expect(names).not.toContain('save_strength_template');
      expect(names).not.toContain('search_exercises');
    }
  });

  it('las que escriben no van como solo lectura', () => {
    const t = toolsFor([fakeApp('motra')]);
    expect(t.save_strength_template.annotations).toMatchObject({ readOnlyHint: false });
    expect(t.delete_strength_template.annotations).toMatchObject({ destructiveHint: true });
    expect(t.list_strength_templates.annotations).toBeUndefined();
  });

  it('con una sola app, `app` sobra', async () => {
    const motra = fakeApp('motra');
    const t = toolsFor([motra]);
    expect(await t.save_strength_template.handler(session)).toEqual({
      app: 'motra',
      name: 'Pierna A',
      id: 'motra-NEW',
      created: true,
    });
    expect(motra.saveTemplate).toHaveBeenCalledWith(
      { name: 'Pierna A', notes: undefined, exercises: session.exercises },
      {},
    );
  });

  it('con varias, hay que decir cuál (y se usa esa)', async () => {
    const motra = fakeApp('motra');
    const hevy = fakeApp('hevy');
    const t = toolsFor([motra, hevy]);
    await expect(t.save_strength_template.handler(session)).rejects.toThrow(/pregúntale en cuál/);
    await expect(t.search_exercises.handler({ query: 'bench' })).rejects.toBeInstanceOf(ToolError);

    const found = await t.search_exercises.handler({ app: 'hevy', query: 'bench' });
    expect(found).toEqual({
      app: 'hevy',
      exercises: [{ exerciseId: 'hevy-bench', name: 'Bench Press' }],
    });
    expect(motra.searchExercises).not.toHaveBeenCalled();

    await t.save_strength_template.handler({ ...session, app: 'hevy', templateId: 'hevy-T1' });
    expect(hevy.saveTemplate).toHaveBeenCalledWith(expect.any(Object), { templateId: 'hevy-T1' });
  });

  it('list sin app: las plantillas de cada app con su límite', async () => {
    const out = await toolsFor([fakeApp('motra'), fakeApp('hevy')]).list_strength_templates.handler(
      {},
    );
    expect(out.apps.map((a) => [a.app, a.maxTemplates, a.templates[0].id])).toEqual([
      ['motra', 2, 'motra-T1'],
      ['hevy', 2, 'hevy-T1'],
    ]);
  });

  it('get: las series en corto y el descanso medio', async () => {
    const out = await toolsFor([fakeApp('motra')]).get_strength_template.handler({
      templateId: 'T1-xxxxxx',
    });
    expect(out.exercises).toEqual([
      { exerciseId: 'squat', name: 'Back Squat', sets: ['5x80', '5x80'], restS: 150 },
      { exerciseId: 'plank', name: 'Plank', sets: ['45s'] },
    ]);
  });

  it('delete dice qué borró', async () => {
    const motra = fakeApp('motra');
    expect(
      await toolsFor([motra]).delete_strength_template.handler({ templateId: 'motra-T1' }),
    ).toEqual({ app: 'motra', deleted: 'motra-T1' });
  });

  it('un error de la app llega a la IA con su mensaje', async () => {
    const motra = fakeApp('motra');
    motra.deleteTemplate.mockRejectedValue(
      new StrengthError(StrengthErrorCode.NOT_OURS, 'Esa plantilla es del usuario'),
    );
    const call = toolsFor([motra]).delete_strength_template.handler({ templateId: 'motra-T1' });
    await expect(call).rejects.toBeInstanceOf(ToolError);
    await expect(call).rejects.toThrow('Esa plantilla es del usuario');
  });
});
