import { describe, expect, it, vi } from 'vitest';
import {
  ClinicalError,
  ClinicalErrorCode,
  buildExtraction,
  createMemoryClinicalStore,
  modelOutputSchema,
} from '@digitaltwin/clinical';
import { AiLimitError } from '@digitaltwin/llm-usage';
import { createClinicalProcessor } from '../src/clinical.js';

const PDF = Buffer.from('%PDF-1.4 x');
const output = modelOutputSchema.parse({ type: 'lab', title: 'Analítica', date: '2026-10-07' });

async function setup({
  process,
  extractorFor = async () => ({ extractor: { extract: vi.fn() }, own: false }),
} = {}) {
  const store = createMemoryClinicalStore({
    users: new Map([['u1', { name: 'Pedro Pérez', email: 'pedro@x.com' }]]),
  });
  await store.saveAliases('u1', [['Antígeno raro', 'lab.crp']]);
  const { document } = await store.create({ userId: 'u1', fileName: 'a.pdf', data: PDF });
  const processor = createClinicalProcessor({ store, extractorFor, process });
  return { store, processor, id: document.id };
}

describe('createClinicalProcessor', () => {
  it('lee el PDF con los nombres del usuario y sus alias, y lo deja para revisar', async () => {
    const process = vi.fn().mockResolvedValue({
      text: 'texto',
      redactions: 4,
      extraction: buildExtraction(output, 'Fecha: 07/10/2026'),
    });
    const { store, processor, id } = await setup({ process });

    await expect(processor.run({ documentId: id })).resolves.toEqual({ type: 'lab', items: 0 });
    const call = process.mock.calls[0][0];
    expect(Buffer.from(call.data).equals(PDF)).toBe(true);
    expect(call.names).toEqual(['Pedro Pérez', 'pedro']);
    expect(call.aliases).toEqual(new Map([['antigeno raro', 'lab.crp']]));
    expect(call.context).toEqual({ userId: 'u1', own: false });
    expect(await store.get('u1', id)).toMatchObject({
      status: 'review',
      type: 'lab',
      date: '2026-10-07',
      text: 'texto',
      redactions: 4,
    });
  });

  it('un fallo pasajero se reintenta; en el último intento queda en error', async () => {
    const process = vi
      .fn()
      .mockRejectedValue(
        new ClinicalError(ClinicalErrorCode.TIMEOUT, 'El modelo ha tardado demasiado'),
      );
    const { store, processor, id } = await setup({ process });

    await expect(processor.run({ documentId: id }, { last: false })).rejects.toThrow('tardado');
    expect((await store.get('u1', id)).status).toBe('processing');

    await expect(processor.run({ documentId: id }, { last: true })).resolves.toEqual({
      failed: 'TIMEOUT',
    });
    expect(await store.get('u1', id)).toMatchObject({
      status: 'error',
      error: 'El modelo ha tardado demasiado',
    });
  });

  it('un PDF escaneado no se reintenta: error a la primera', async () => {
    const process = vi
      .fn()
      .mockRejectedValue(
        new ClinicalError(ClinicalErrorCode.NO_TEXT, 'El PDF no tiene texto (¿escaneado?)'),
      );
    const { store, processor, id } = await setup({ process });
    await expect(processor.run({ documentId: id }, { last: false })).resolves.toEqual({
      failed: 'NO_TEXT',
    });
    expect((await store.get('u1', id)).status).toBe('error');
  });

  it('sin LLM lo explica y no lo intenta', async () => {
    const process = vi.fn();
    const { store, processor, id } = await setup({ process, extractorFor: async () => undefined });
    await processor.run({ documentId: id });
    expect(process).not.toHaveBeenCalled();
    expect((await store.get('u1', id)).error).toMatch(/LLM_API_KEY/);
  });

  it('si ya ha gastado su IA de hoy, queda en error con el motivo y no lo intenta', async () => {
    const process = vi.fn();
    const limit = new AiLimitError({ spentUsd: 0.3, limitUsd: 0.25 });
    const { store, processor, id } = await setup({
      process,
      extractorFor: async () => {
        throw limit;
      },
    });
    await expect(processor.run({ documentId: id }, { last: false })).resolves.toEqual({
      failed: 'AI_LIMIT',
    });
    expect(process).not.toHaveBeenCalled();
    expect(await store.get('u1', id)).toMatchObject({ status: 'error', error: limit.message });
  });

  it('con su clave, la cuenta del gasto lo sabe', async () => {
    const process = vi.fn().mockResolvedValue({
      text: 'texto',
      redactions: 0,
      extraction: buildExtraction(output, ''),
    });
    const extractor = { extract: vi.fn() };
    const { processor, id } = await setup({
      process,
      extractorFor: async () => ({ extractor, own: true }),
    });
    await processor.run({ documentId: id });
    expect(process.mock.calls[0][0]).toMatchObject({
      extractor,
      context: { userId: 'u1', own: true },
    });
  });

  it('un documento borrado mientras esperaba se salta', async () => {
    const { store, processor, id } = await setup();
    await store.remove('u1', id);
    await expect(processor.run({ documentId: id })).resolves.toEqual({ skipped: 'missing' });
  });
});
