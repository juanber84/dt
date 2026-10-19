export const GoogleHealthErrorCode = Object.freeze({
  /** El refresh token ya no vale (caducado o revocado): el usuario tiene que volver a autorizar. */
  REAUTH_REQUIRED: 'REAUTH_REQUIRED',
  /** Falta el scope para ese tipo de dato o la API no lo permite. */
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  API_ERROR: 'API_ERROR',
  INVALID_WEBHOOK: 'INVALID_WEBHOOK',
});

export class GoogleHealthError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'GoogleHealthError';
    this.code = code;
    this.details = details;
  }
}

/** Convierte un error de gaxios/google-auth-library en GoogleHealthError. */
export function toGoogleHealthError(error) {
  if (error instanceof GoogleHealthError) return error;

  const status = error.response?.status ?? error.status;
  const body = error.response?.data;
  const apiMessage = body?.error?.message ?? body?.error_description ?? error.message;

  // Fallo al refrescar: invalid_grant = refresh token caducado/revocado
  if (body?.error === 'invalid_grant' || /invalid_grant/.test(error.message ?? '')) {
    return new GoogleHealthError(
      GoogleHealthErrorCode.REAUTH_REQUIRED,
      'La autorización de Google ha caducado o se ha revocado; el usuario tiene que volver a conectar',
      { status, apiMessage },
    );
  }

  const code =
    {
      400: GoogleHealthErrorCode.INVALID_REQUEST,
      401: GoogleHealthErrorCode.REAUTH_REQUIRED,
      403: GoogleHealthErrorCode.PERMISSION_DENIED,
      404: GoogleHealthErrorCode.NOT_FOUND,
      429: GoogleHealthErrorCode.RATE_LIMITED,
    }[status] ?? GoogleHealthErrorCode.API_ERROR;

  return new GoogleHealthError(code, `Google Health API: ${apiMessage}`, {
    status,
    apiStatus: body?.error?.status,
  });
}
