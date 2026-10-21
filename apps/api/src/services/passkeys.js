import { SignJWT, jwtVerify } from 'jose';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { readCookie } from '../utils/cookies.js';

export const CHALLENGE_COOKIE = 'dt_webauthn';
const CHALLENGE_TTL_S = 5 * 60;
const ISSUER = 'digitaltwin-webauthn';

/**
 * Passkeys en la BD (tabla passkeys).
 * @param {{ db: import('postgres').Sql }} deps
 */
export function createDbPasskeyStore({ db }) {
  const fromRow = (r) => ({
    id: r.id,
    userId: r.user_id,
    publicKey: new Uint8Array(r.public_key),
    counter: Number(r.counter),
    transports: r.transports,
    deviceType: r.device_type,
    backedUp: r.backed_up,
    name: r.name,
    createdAt: r.created_at.toISOString(),
    lastUsedAt: r.last_used_at?.toISOString() ?? null,
  });

  return {
    async listByUser(userId) {
      const rows = await db`
        select * from passkeys where user_id = ${userId} order by created_at
      `;
      return rows.map(fromRow);
    },
    async get(id) {
      const [row] = await db`select * from passkeys where id = ${id}`;
      return row ? fromRow(row) : null;
    },
    async save(p) {
      await db`
        insert into passkeys (id, user_id, public_key, counter, transports, device_type, backed_up, name)
        values (${p.id}, ${p.userId}, ${Buffer.from(p.publicKey)}, ${p.counter}, ${p.transports},
          ${p.deviceType}, ${p.backedUp}, ${p.name})
      `;
    },
    async used(id, counter) {
      await db`update passkeys set counter = ${counter}, last_used_at = now() where id = ${id}`;
    },
    /** @returns {Promise<boolean>} si era suya y se ha borrado */
    async remove(userId, id) {
      const result = await db`delete from passkeys where id = ${id} and user_id = ${userId}`;
      return result.count > 0;
    },
  };
}

/**
 * Entrar con Face ID / Touch ID (WebAuthn). El reto de cada intento va firmado en una cookie de
 * 5 min, así no hay que guardar estado en la API. La passkey queda ligada al dominio de PUBLIC_URL:
 * una dada de alta en producción no vale en local y al revés.
 *
 * @param {object} options
 * @param {ReturnType<typeof createDbPasskeyStore>} options.store
 * @param {string} options.publicUrl  De aquí salen el dominio (rpID) y el origen esperado.
 * @param {string[]} [options.extraOrigins]  Otros orígenes válidos (Vite en desarrollo).
 * @param {string} options.secret  Para firmar el reto (el de las sesiones).
 * @param {boolean} [options.secure]  Cookie solo por HTTPS.
 */
export function createPasskeys({ store, publicUrl, extraOrigins = [], secret, secure = false }) {
  const rpID = new URL(publicUrl).hostname;
  const origins = [new URL(publicUrl).origin, ...extraOrigins];
  const key = new TextEncoder().encode(secret);
  const cookieOptions = { httpOnly: true, secure, sameSite: 'strict', path: '/api/v1' };

  async function keepChallenge(res, challenge, purpose, userId = null) {
    const token = await new SignJWT({ challenge, purpose, userId })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setExpirationTime(`${CHALLENGE_TTL_S}s`)
      .sign(key);
    res.cookie(CHALLENGE_COOKIE, token, { ...cookieOptions, maxAge: CHALLENGE_TTL_S * 1000 });
  }

  /** El reto que se pidió para esto (y se gasta: un reto, un intento). */
  async function takeChallenge(req, res, purpose) {
    res.clearCookie(CHALLENGE_COOKIE, cookieOptions);
    const token = readCookie(req.headers.cookie, CHALLENGE_COOKIE);
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'], issuer: ISSUER });
      return payload.purpose === purpose ? payload : null;
    } catch {
      return null;
    }
  }

  return {
    rpID,
    list: (userId) => store.listByUser(userId),
    remove: (userId, id) => store.remove(userId, id),

    /** Paso 1 del alta (con sesión): qué tiene que crear el dispositivo. */
    async registrationOptions(res, user) {
      const existing = await store.listByUser(user.id);
      const options = await generateRegistrationOptions({
        rpName: 'Digital Twin',
        rpID,
        userName: user.email,
        userDisplayName: user.name ?? user.email,
        userID: new TextEncoder().encode(user.id),
        attestationType: 'none',
        // No dar de alta dos veces el mismo dispositivo
        excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      });
      await keepChallenge(res, options.challenge, 'register', user.id);
      return options;
    },

    /** Paso 2 del alta: comprueba lo que ha firmado el dispositivo y la guarda. */
    async register(req, res, user, response, name) {
      const challenge = await takeChallenge(req, res, 'register');
      if (!challenge || challenge.userId !== user.id) return { ok: false, reason: 'challenge' };
      const { verified, registrationInfo: info } = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
      });
      if (!verified || !info) return { ok: false, reason: 'unverified' };
      await store.save({
        id: info.credential.id,
        userId: user.id,
        publicKey: info.credential.publicKey,
        counter: info.credential.counter,
        transports: info.credential.transports ?? response.response?.transports ?? [],
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        name,
      });
      return { ok: true, id: info.credential.id };
    },

    /** Paso 1 de entrar (sin sesión): sin lista de credenciales, el dispositivo ofrece las suyas. */
    async authenticationOptions(res) {
      const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
      await keepChallenge(res, options.challenge, 'login');
      return options;
    },

    /** Paso 2 de entrar: de quién es la passkey y si la firma es buena. Devuelve el userId. */
    async authenticate(req, res, response) {
      const challenge = await takeChallenge(req, res, 'login');
      if (!challenge) return { ok: false, reason: 'challenge' };
      const passkey = typeof response?.id === 'string' ? await store.get(response.id) : null;
      if (!passkey) return { ok: false, reason: 'unknown' };
      const { verified, authenticationInfo } = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        credential: {
          id: passkey.id,
          publicKey: passkey.publicKey,
          counter: passkey.counter,
          transports: passkey.transports,
        },
      });
      if (!verified) return { ok: false, reason: 'unverified' };
      await store.used(passkey.id, authenticationInfo.newCounter);
      return { ok: true, userId: passkey.userId };
    },
  };
}
