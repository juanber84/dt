import { spawn } from 'node:child_process';
import { ClinicalError, ClinicalErrorCode } from './errors.js';

const MAX_PAGES = 40;
const TIMEOUT_MS = 30_000;

/**
 * Texto de un PDF con `pdftotext -layout` (poppler-utils): conserva las columnas, así las tablas de
 * los informes (prueba, resultado, unidades, rango) siguen en su fila. Solo PDFs con texto: uno
 * escaneado sale vacío y se avisa con NO_TEXT.
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
  const clean = text
    .replace(/\f/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  if (clean.replace(/\s/g, '').length < 20) {
    throw new ClinicalError(
      ClinicalErrorCode.NO_TEXT,
      'El PDF no tiene texto (¿escaneado?): de momento solo se leen PDFs con texto',
    );
  }
  return clean;
}

/** Los PDF empiezan por "%PDF-" (a veces con algo de basura delante, se mira el primer KB). */
export function isPdf(data) {
  const head = Buffer.from(data.subarray(0, 1024)).toString('latin1');
  return head.includes('%PDF-');
}

function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(
        error.code === 'ENOENT'
          ? new ClinicalError(
              ClinicalErrorCode.PDF_TOOL_MISSING,
              `No está ${command} (instala poppler-utils)`,
            )
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
    child.stdin.end(Buffer.from(input));
  });
}
