import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { ClinicalExtractor } from '../src/extractor.js';
import { ClinicalErrorCode } from '../src/errors.js';
import { extractPdfText, isPdf } from '../src/pdf.js';
import { processPdf } from '../src/index.js';
import { LAB_OUTPUT, LAB_TEXT } from './fixtures.js';

function reply(content, status = 200, usage = { prompt_tokens: 100, completion_tokens: 50 }) {
  const body = status === 200 ? { choices: [{ message: { content } }], usage } : content;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function build(...responses) {
  const fetch = vi.fn();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  const onUsage = vi.fn();
  return {
    fetch,
    onUsage,
    extractor: new ClinicalExtractor({ apiKey: 'sk-test', fetch, onUsage }),
  };
}

describe('ClinicalExtractor', () => {
  it('pide JSON a DeepSeek sin thinking, a temperatura 0, y apunta el gasto', async () => {
    const { fetch, onUsage, extractor } = build(reply(JSON.stringify(LAB_OUTPUT)));
    const output = await extractor.extract('texto del informe', { userId: 'u1' });

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: 'deepseek-flash',
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      temperature: 0,
    });
    expect(body.messages[0].content).toMatch(/json/);
    expect(body.messages[1].content).toContain('texto del informe');
    expect(output.items).toHaveLength(7);
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'clinical.extract',
        userId: 'u1',
        usage: expect.any(Object),
      }),
    );
  });

  it('reintenta una vez si la respuesta no es JSON', async () => {
    const { fetch, extractor } = build(reply('no es json'), reply(JSON.stringify(LAB_OUTPUT)));
    await expect(extractor.extract('x')).resolves.toMatchObject({ type: 'lab' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('un error del proveedor no se reintenta', async () => {
    const { fetch, extractor } = build(reply({ error: { message: 'Insufficient Balance' } }, 402));
    await expect(extractor.extract('x')).rejects.toMatchObject({
      code: ClinicalErrorCode.API_ERROR,
      message: '402: Insufficient Balance',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('lo que el modelo no sabe rellenar se queda en null o vacío', async () => {
    const { extractor } = build(
      reply(JSON.stringify({ type: 'raro', items: [{ name: 'Glucosa', value: 'mucho' }] })),
    );
    const output = await extractor.extract('x');
    expect(output).toMatchObject({
      type: 'report',
      date: null,
      measures: [],
      hourly: [],
      report: null,
    });
    expect(output.items[0]).toMatchObject({ name: 'Glucosa', value: null, unit: null });
  });
});

describe('processPdf', () => {
  it('al modelo solo le llega el texto sin datos personales', async () => {
    const extract = vi
      .fn()
      .mockResolvedValue((await import('../src/schema.js')).modelOutputSchema.parse(LAB_OUTPUT));
    const result = await processPdf({
      data: new Uint8Array(),
      extractor: { extract },
      pdfText: async () => LAB_TEXT,
      context: { userId: 'u1' },
    });
    const sent = extract.mock.calls[0][0];
    expect(sent).not.toContain('PEREZ');
    expect(sent).not.toContain('12345678Z');
    expect(extract.mock.calls[0][1]).toEqual({ userId: 'u1' });
    expect(result.text).toBe(sent);
    expect(result.redactions).toBeGreaterThan(0);
    expect(result.extraction.items).toHaveLength(7);
  });
});

const hasPdftotext = spawnSync('pdftotext', ['-v']).error === undefined;

describe('extractPdfText', () => {
  it('rechaza lo que no es un PDF', async () => {
    expect(isPdf(Buffer.from('hola'))).toBe(false);
    await expect(extractPdfText(Buffer.from('hola'))).rejects.toMatchObject({
      code: ClinicalErrorCode.INVALID_PDF,
    });
  });

  it.skipIf(!hasPdftotext)('saca el texto conservando las columnas', async () => {
    const pdf = makePdf([
      'Prueba          Resultado    Unidades',
      'Glucosa         79           mg/dl',
    ]);
    const text = await extractPdfText(pdf);
    expect(text).toMatch(/Glucosa\s+79\s+mg\/dl/);
  });

  it.skipIf(!hasPdftotext)('un PDF sin texto (escaneado) avisa', async () => {
    await expect(extractPdfText(makePdf([]))).rejects.toMatchObject({
      code: ClinicalErrorCode.NO_TEXT,
    });
  });

  it('sin pdftotext lo dice claro', async () => {
    await expect(
      extractPdfText(makePdf(['x']), { command: 'no-existe-pdftotext' }),
    ).rejects.toMatchObject({
      code: ClinicalErrorCode.PDF_TOOL_MISSING,
    });
  });
});

/** Un PDF mínimo de una página con líneas en Courier (monoespaciada, como una tabla). */
function makePdf(lines) {
  const content = lines
    .map((line, i) => `BT /F1 10 Tf 40 ${780 - i * 14} Td (${line}) Tj ET`)
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
