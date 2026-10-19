import { HttpError } from '../utils/http-error.js';

/**
 * Valida req.body / req.query / req.params con esquemas zod.
 * Los valores parseados quedan en req.validated.{body,query,params}.
 *
 * @example router.post('/', validate({ body: schema }), controller)
 */
export function validate(schemas) {
  return (req, _res, next) => {
    req.validated = {};
    for (const part of ['params', 'query', 'body']) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);
      if (!result.success) {
        return next(
          HttpError.badRequest('Datos de entrada inválidos', {
            code: 'VALIDATION_ERROR',
            details: result.error.issues.map((issue) => ({
              location: part,
              path: issue.path.join('.'),
              message: issue.message,
            })),
          }),
        );
      }
      req.validated[part] = result.data;
    }
    next();
  };
}
