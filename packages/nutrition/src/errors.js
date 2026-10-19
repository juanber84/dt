export const NutritionErrorCode = Object.freeze({
  /** El proveedor respondió con error HTTP (clave inválida, saldo, rate limit...). */
  API_ERROR: 'API_ERROR',
  /** El modelo devolvió contenido vacío (DeepSeek avisa de que a veces pasa en modo JSON). */
  EMPTY_RESPONSE: 'EMPTY_RESPONSE',
  /** El modelo devolvió algo que no es el JSON esperado. */
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  TIMEOUT: 'TIMEOUT',
});

export class NutritionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'NutritionError';
    this.code = code;
    this.details = details;
  }
}
