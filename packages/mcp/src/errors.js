/** Error que se le cuenta a la IA (argumentos fuera de rango...), no un fallo del servidor. */
export class ToolError extends Error {
  name = 'ToolError';
}
