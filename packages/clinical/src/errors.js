export const ClinicalErrorCode = Object.freeze({
  /** No hay `pdftotext` (poppler-utils) en la máquina. */
  PDF_TOOL_MISSING: 'PDF_TOOL_MISSING',
  /** El fichero no es un PDF o está dañado. */
  INVALID_PDF: 'INVALID_PDF',
  /** El PDF no tiene texto (escaneado o foto): de momento no se lee. */
  NO_TEXT: 'NO_TEXT',
  /** El proveedor respondió con error HTTP (clave inválida, saldo, rate limit...). */
  API_ERROR: 'API_ERROR',
  /** El modelo devolvió contenido vacío (DeepSeek avisa de que a veces pasa en modo JSON). */
  EMPTY_RESPONSE: 'EMPTY_RESPONSE',
  /** El modelo devolvió algo que no es el JSON esperado. */
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  TIMEOUT: 'TIMEOUT',
});

export class ClinicalError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ClinicalError';
    this.code = code;
    this.details = details;
  }
}
