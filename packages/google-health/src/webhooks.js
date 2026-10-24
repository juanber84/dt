import crypto from 'node:crypto';
import { GoogleHealthError, GoogleHealthErrorCode } from './errors.js';

export const WEBHOOK_KEYSET_URL =
  'https://www.gstatic.com/googlehealthapi/webhooks/webhooks_public_keyset.json';
const KEYSET_TTL_MS = 60 * 60 * 1000;
const CIVIL_PADDING_MS = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------------
// Tink: keyset JSON -> claves públicas ECDSA P-256
// ------------------------------------------------------------------

/** Lee un mensaje protobuf plano: { fieldNumber: Buffer|number } (solo varint y length-delimited). */
function readProto(buf) {
  const fields = {};
  let pos = 0;
  const varint = () => {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      const byte = buf[pos++];
      result |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return result;
      shift += 7n;
    }
  };
  while (pos < buf.length) {
    const tag = Number(varint());
    const field = tag >> 3;
    const wire = tag & 7;
    if (wire === 0) fields[field] = Number(varint());
    else if (wire === 2) {
      const len = Number(varint());
      fields[field] = buf.subarray(pos, pos + len);
      pos += len;
    } else throw new Error(`Wire type protobuf no soportado: ${wire}`);
  }
  return fields;
}

/** Entero big-endian (con posible 0x00 inicial) -> 32 bytes. */
function toFixed32(bytes) {
  const trimmed = bytes.subarray(Math.max(0, bytes.length - 32));
  return Buffer.concat([Buffer.alloc(32 - trimmed.length), trimmed]);
}

/**
 * Convierte el keyset público de Tink en un Map keyId -> KeyObject.
 * EcdsaPublicKey proto: 1 version, 2 params, 3 x, 4 y.
 */
export function parseTinkKeyset(keyset) {
  const keys = new Map();
  for (const key of keyset.key ?? []) {
    if (key.status !== 'ENABLED') continue;
    if (!key.keyData?.typeUrl?.endsWith('EcdsaPublicKey')) continue;
    const proto = readProto(Buffer.from(key.keyData.value, 'base64'));
    const jwk = {
      kty: 'EC',
      crv: 'P-256',
      x: toFixed32(proto[3]).toString('base64url'),
      y: toFixed32(proto[4]).toString('base64url'),
    };
    keys.set(key.keyId >>> 0, {
      key: crypto.createPublicKey({ key: jwk, format: 'jwk' }),
      outputPrefixType: key.outputPrefixType,
    });
  }
  return keys;
}

/**
 * Verifica la cabecera GOOGLE-HEALTH-API-SIGNATURE (base64) sobre el body crudo.
 * Formato Tink: 1 byte 0x01 + keyId (uint32 BE) + firma ECDSA DER (SHA-256).
 */
export function verifySignature(rawBody, signatureBase64, keys) {
  if (!signatureBase64) return false;
  const signature = Buffer.from(signatureBase64, 'base64');
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);

  if (signature.length > 5 && signature[0] === 0x01) {
    const entry = keys.get(signature.readUInt32BE(1));
    if (entry) {
      return crypto.verify(
        'sha256',
        body,
        { key: entry.key, dsaEncoding: 'der' },
        signature.subarray(5),
      );
    }
  }
  // Clave RAW (sin prefijo): probar todas
  for (const { key, outputPrefixType } of keys.values()) {
    if (outputPrefixType !== 'RAW') continue;
    if (crypto.verify('sha256', body, { key, dsaEncoding: 'der' }, signature)) return true;
  }
  return false;
}

function createKeysetProvider({ keyset, keysetUrl = WEBHOOK_KEYSET_URL, fetchImpl = fetch }) {
  if (keyset) {
    const keys = parseTinkKeyset(keyset);
    return async () => keys;
  }
  let cache;
  let loadedAt = 0;
  return async (force = false) => {
    if (!cache || force || Date.now() - loadedAt > KEYSET_TTL_MS) {
      const response = await fetchImpl(keysetUrl);
      if (!response.ok) throw new Error(`No se pudo descargar el keyset (${response.status})`);
      cache = parseTinkKeyset(await response.json());
      loadedAt = Date.now();
    }
    return cache;
  };
}

/** Valor de la cabecera Authorization: acepta la clave sola o ya con "Bearer " delante. */
export function toAuthorization(secret) {
  const value = String(secret).trim();
  return /^bearer\s/i.test(value) ? value : `Bearer ${value}`;
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// ------------------------------------------------------------------
// Notificaciones
// ------------------------------------------------------------------

/**
 * @typedef {object} HealthNotification
 * @property {string} healthUserId
 * @property {string} dataType
 * @property {'UPSERT'|'DELETE'} operation
 * @property {object[]} intervals
 * @property {string|null} recordId
 * @property {string|null} subscriptionName
 * @property {object} raw
 */

/** Normaliza el body (objeto o array, cada elemento con o sin envoltorio `data`). */
export function parseNotifications(body) {
  const json = typeof body === 'string' || Buffer.isBuffer(body) ? JSON.parse(body) : body;
  const items = Array.isArray(json) ? json : [json];
  return items.map((item) => {
    const n = item.data ?? item;
    return {
      healthUserId: n.healthUserId ?? null,
      dataType: n.dataType ?? null,
      operation: n.operation ?? null,
      intervals: n.intervals ?? [],
      recordId: n.recordId ?? null,
      subscriptionName: n.clientProvidedSubscriptionName ?? null,
      raw: item,
    };
  });
}

/**
 * Rango [from, to) a consultar con listDataPoints para recoger lo que indica una notificación.
 * Si solo viene hora local (datos diarios), amplía un día por cada lado para cubrir cualquier zona horaria.
 */
export function notificationToQuery(notification) {
  let from = Infinity;
  let to = -Infinity;
  for (const interval of notification.intervals) {
    const physical = interval.physicalTimeInterval;
    if (physical?.startTime) {
      from = Math.min(from, new Date(physical.startTime).getTime());
      to = Math.max(to, new Date(physical.endTime ?? physical.startTime).getTime());
      continue;
    }
    const civil = interval.civilIso8601TimeInterval;
    if (civil?.startTime) {
      from = Math.min(from, new Date(`${civil.startTime}Z`).getTime() - CIVIL_PADDING_MS);
      to = Math.max(
        to,
        new Date(`${civil.endTime ?? civil.startTime}Z`).getTime() + CIVIL_PADDING_MS,
      );
    }
  }
  if (!Number.isFinite(from)) return null;
  if (to <= from)
    to = from + 1000; // rango semiabierto: asegura que incluye el instante
  else to += 1000;
  return { dataType: notification.dataType, from: new Date(from), to: new Date(to) };
}

/**
 * Handler independiente del framework para el endpoint de webhooks.
 * Necesita el body CRUDO (para verificar la firma).
 *
 * @param {object} options
 * @param {string} options.secret  El mismo valor configurado en endpointAuthorization.secret
 *   (se compara con la cabecera Authorization completa; "xxx" y "Bearer xxx" valen igual).
 * @param {string[]} [options.previousSecrets]  Durante una rotación de secreto.
 * @param {boolean} [options.verifySignature=true]
 * @param {object} [options.keyset]  Keyset fijo (tests); si no, se descarga y cachea.
 * @returns {(req: { headers: Record<string,string>, body: Buffer|string }) => Promise<{
 *   status: number, type: 'verification'|'notifications'|'rejected', notifications: HealthNotification[], reason?: string }>}
 */
export function createWebhookHandler({
  secret,
  previousSecrets = [],
  verifySignature: shouldVerify = true,
  keyset,
  keysetUrl,
  fetchImpl,
}) {
  if (!secret) throw new Error('El secreto del webhook es obligatorio');
  const getKeys = createKeysetProvider({ keyset, keysetUrl, fetchImpl });
  const secrets = [secret, ...previousSecrets].map(toAuthorization);

  const reject = (reason, status = 401) => ({
    status,
    type: 'rejected',
    notifications: [],
    reason,
  });

  return async ({ headers, body }) => {
    const header = (name) => headers[name] ?? headers[name.toLowerCase()];
    // Sin cabecera es lo normal en la verificación de Google (prueba que rechazamos lo anónimo);
    // con una que no casa, no
    if (!header('authorization')) return reject('Sin Authorization');
    const authorized = secrets.some((s) => safeEqual(header('authorization'), s));
    if (!authorized) return reject('Authorization no válida');

    let parsed;
    try {
      parsed = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : body);
    } catch {
      return reject('Body no es JSON', 400);
    }

    // Verificación del endpoint al crear/modificar el suscriptor
    if (!Array.isArray(parsed) && parsed?.type === 'verification') {
      return { status: 200, type: 'verification', notifications: [] };
    }

    if (shouldVerify) {
      const signature = header('google-health-api-signature');
      let valid = verifySignature(body, signature, await getKeys());
      if (!valid && !keyset) valid = verifySignature(body, signature, await getKeys(true)); // rotación de claves
      if (!valid) return reject('Firma no válida');
    }

    return { status: 204, type: 'notifications', notifications: parseNotifications(parsed) };
  };
}

export function assertWebhookResult(result) {
  if (result.type === 'rejected') {
    throw new GoogleHealthError(GoogleHealthErrorCode.INVALID_WEBHOOK, result.reason);
  }
  return result;
}
