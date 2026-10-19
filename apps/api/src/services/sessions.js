import { SignJWT, jwtVerify } from 'jose';
import { readCookie } from '../utils/cookies.js';

export const SESSION_COOKIE = 'dt_session';
const ISSUER = 'digitaltwin';
const REMEMBER_S = 30 * 24 * 3600;
const SHORT_S = 12 * 3600;

/**
 * Sesiones como JWT firmados (HS256) que viajan en una cookie HttpOnly: el navegador la manda sola
 * y ningún script de la página puede leerla. El JWT solo lleva el id: el rol se lee del usuario en
 * cada petición, así un cambio de rol vale al momento.
 * @param {object} options
 * @param {string} options.secret Al menos 32 caracteres.
 * @param {boolean} [options.secure] Cookie solo por HTTPS (producción).
 */
export function createSessions({ secret, secure = false }) {
  const key = new TextEncoder().encode(secret);

  const cookieOptions = { httpOnly: true, secure, sameSite: 'strict', path: '/' };

  return {
    /** Firma la sesión y la deja en la cookie. Sin `remember`, dura hasta cerrar el navegador (y 12 h como mucho). */
    async start(res, user, { remember = false } = {}) {
      const ttl = remember ? REMEMBER_S : SHORT_S;
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(user.id)
        .setIssuer(ISSUER)
        .setIssuedAt()
        .setExpirationTime(`${ttl}s`)
        .sign(key);
      res.cookie(SESSION_COOKIE, token, {
        ...cookieOptions,
        ...(remember && { maxAge: ttl * 1000 }),
      });
    },

    end(res) {
      res.clearCookie(SESSION_COOKIE, cookieOptions);
    },

    /** Id del usuario de la cookie, o null si no hay, está manipulada o ha caducado. */
    async read(req) {
      const token = readCookie(req.headers.cookie, SESSION_COOKIE);
      if (!token) return null;
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'], issuer: ISSUER });
        return payload.sub ?? null;
      } catch {
        return null;
      }
    },
  };
}
