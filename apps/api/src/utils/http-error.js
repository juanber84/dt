export class HttpError extends Error {
  /**
   * @param {number} status Código HTTP.
   * @param {string} message Mensaje para el cliente.
   * @param {object} [options]
   * @param {string} [options.code] Código de error estable para el frontal.
   * @param {unknown} [options.details] Información adicional (p. ej. errores de validación).
   */
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code ?? defaultCode(status);
    this.details = details;
  }

  static badRequest(message = 'Bad Request', options) {
    return new HttpError(400, message, options);
  }

  static unauthorized(message = 'Unauthorized', options) {
    return new HttpError(401, message, options);
  }

  static forbidden(message = 'Forbidden', options) {
    return new HttpError(403, message, options);
  }

  static notFound(message = 'Not Found', options) {
    return new HttpError(404, message, options);
  }

  static conflict(message = 'Conflict', options) {
    return new HttpError(409, message, options);
  }
}

function defaultCode(status) {
  const codes = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'UNPROCESSABLE_ENTITY',
    429: 'TOO_MANY_REQUESTS',
  };
  return codes[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR');
}
