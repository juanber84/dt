import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClinicalError, ClinicalErrorCode } from './errors.js';

const MAX_PAGES = 40;
const TIMEOUT_MS = 30_000;
// OCR: cada página es una imagen a 300 ppp que tesseract tarda unos segundos en leer
const OCR_MAX_PAGES = 10;
const OCR_DPI = 300;
const OCR_TIMEOUT_MS = 120_000;
const MIN_CHARS = 20;

/**
 * Texto de un PDF con `pdftotext -layout` (poppler-utils): conserva las columnas, así las tablas de
 * los informes (prueba, resultado, unidades, rango) siguen en su fila. Uno escaneado sale vacío y
 * se avisa con NO_TEXT (readPdf lo pasa entonces por OCR).
 * @param {Uint8Array} data
 * @param {{ command?: string, maxPages?: number }} [options]
 * @returns {Promise<string>}
 */
export async function extractPdfText(data, { command = 'pdftotext', maxPages = MAX_PAGES } = {}) {
  if (!isPdf(data)) throw new ClinicalError(ClinicalErrorCode.INVALID_PDF, 'No es un PDF');
  const text = await run(
    command,
    ['-layout', '-enc', 'UTF-8', '-l', String(maxPages), '-', '-'],
    data,
  );
  const clean = tidy(text);
  if (!enough(clean)) {
    throw new ClinicalError(ClinicalErrorCode.NO_TEXT, 'El PDF no tiene texto (¿escaneado?)');
  }
  return clean;
}

/**
 * Texto de un PDF: el que trae y, si no trae (escaneado o foto), el que saca el OCR (pdftoppm
 * pasa cada página a imagen y tesseract la lee). `ocr` dice si hizo falta, para avisar en la
 * revisión de que los números pueden venir mal leídos.
 * @param {Uint8Array} data
 * @param {{ ocr?: boolean, pdftotext?: string, pdftoppm?: string, tesseract?: string,
 *   language?: string, maxOcrPages?: number }} [options]
 * @returns {Promise<{ text: string, ocr: boolean }>}
 */
export async function readPdf(
  data,
  {
    ocr = true,
    pdftotext = 'pdftotext',
    pdftoppm = 'pdftoppm',
    tesseract = 'tesseract',
    language = 'spa',
    maxOcrPages = OCR_MAX_PAGES,
  } = {},
) {
  try {
    return { text: await extractPdfText(data, { command: pdftotext }), ocr: false };
  } catch (err) {
    if (!ocr || err.code !== ClinicalErrorCode.NO_TEXT) throw err;
  }
  const text = await ocrPdf(data, { pdftoppm, tesseract, language, maxPages: maxOcrPages });
  if (!enough(text)) {
    throw new ClinicalError(
      ClinicalErrorCode.NO_TEXT,
      'El PDF no tiene texto y el OCR tampoco ha sacado nada legible',
    );
  }
  return { text, ocr: true };
}

/** OCR página a página, en una carpeta temporal que se borra al acabar. */
async function ocrPdf(data, { pdftoppm, tesseract, language, maxPages }) {
  const dir = await mkdtemp(join(tmpdir(), 'dt-ocr-'));
  try {
    const pdf = join(dir, 'in.pdf');
    await writeFile(pdf, data);
    await run(
      pdftoppm,
      ['-r', String(OCR_DPI), '-gray', '-png', '-l', String(maxPages), pdf, join(dir, 'page')],
      null,
      { timeout: OCR_TIMEOUT_MS },
    );
    // page-01.png, page-02.png... (mismo ancho de número: el orden alfabético vale)
    const pages = (await readdir(dir)).filter((f) => f.endsWith('.png')).sort();
    const texts = [];
    for (const page of pages) {
      // psm 6 (bloque uniforme) + espacios conservados: las filas de las tablas siguen en su línea
      const args = [join(dir, page), 'stdout', '-l', language, '--psm', '6'];
      args.push('-c', 'preserve_interword_spaces=1');
      texts.push(
        await run(tesseract, args, null, {
          timeout: OCR_TIMEOUT_MS,
          missing: `El PDF no tiene texto y para leerlo con OCR hace falta ${tesseract} (instala tesseract-ocr)`,
        }),
      );
    }
    return tidy(texts.join('\n\n'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const tidy = (text) =>
  text
    .replace(/\f/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();

const enough = (text) => text.replace(/\s/g, '').length >= MIN_CHARS;

/** Los PDF empiezan por "%PDF-" (a veces con algo de basura delante, se mira el primer KB). */
export function isPdf(data) {
  const head = Buffer.from(data.subarray(0, 1024)).toString('latin1');
  return head.includes('%PDF-');
}

function run(
  command,
  args,
  input,
  { timeout = TIMEOUT_MS, missing = `No está ${command} (instala poppler-utils)` } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(
        error.code === 'ENOENT'
          ? new ClinicalError(ClinicalErrorCode.PDF_TOOL_MISSING, missing)
          : error,
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(Buffer.concat(out).toString('utf8'));
      reject(
        new ClinicalError(
          ClinicalErrorCode.INVALID_PDF,
          `No se ha podido leer el PDF: ${Buffer.concat(err).toString('utf8').trim().slice(0, 200) || `código ${code}`}`,
        ),
      );
    });
    // Si el proceso muere antes de leerlo todo, el EPIPE ya lo cuenta 'close'
    child.stdin.on('error', () => {});
    child.stdin.end(input == null ? undefined : Buffer.from(input));
  });
}
