export const XiaomiErrorCode = Object.freeze({
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_CAPTCHA: 'INVALID_CAPTCHA',
  INVALID_EMAIL_CODE: 'INVALID_EMAIL_CODE',
  INVALID_LOGIN_STATE: 'INVALID_LOGIN_STATE',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  UNEXPECTED_RESPONSE: 'UNEXPECTED_RESPONSE',
  API_ERROR: 'API_ERROR',
});

export class XiaomiError extends Error {
  /**
   * @param {keyof typeof XiaomiErrorCode} code
   * @param {string} message
   * @param {object} [details]
   */
  constructor(code, message, details) {
    super(message);
    this.name = 'XiaomiError';
    this.code = code;
    this.details = details;
  }
}
