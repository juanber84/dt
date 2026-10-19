import { HttpError } from '../utils/http-error.js';

/**
 * Manejador central de errores. Respuesta uniforme:
 * { error: { code, message, details?, requestId } }
 */
export function errorHandler({ isProduction }) {
  return (err, req, res, _next) => {
    // Errores de body-parser (JSON malformado, payload demasiado grande...)
    const status = err instanceof HttpError ? err.status : (err.status ?? err.statusCode ?? 500);
    const isServerError = status >= 500;

    if (isServerError) {
      req.log?.error({ err }, 'Error no controlado');
    } else {
      req.log?.warn({ err: { message: err.message, status } }, 'Error de cliente');
    }

    const body = {
      error: {
        code:
          err instanceof HttpError
            ? err.code
            : isServerError
              ? 'INTERNAL_ERROR'
              : (err.type ?? 'ERROR'),
        // En producción se ocultan los 5xx inesperados; los HttpError los escribimos para el cliente
        message:
          isServerError && isProduction && !(err instanceof HttpError)
            ? 'Internal Server Error'
            : err.message,
        ...(err.details ? { details: err.details } : {}),
        requestId: req.id,
        ...(!isProduction && isServerError ? { stack: err.stack } : {}),
      },
    };

    res.status(status).json(body);
  };
}
