import crypto from 'node:crypto';

export function md5Upper(value) {
  return crypto.createHash('md5').update(value).digest('hex').toUpperCase();
}

export function randomString(length, min, max) {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += String.fromCharCode(Math.floor(Math.random() * (max - min + 1)) + min);
  }
  return result;
}

/**
 * RC4 con descarte inicial (por defecto 1024 bytes, como SmartScaleConnect).
 * OpenSSL 3 no expone RC4, así que se implementa a mano.
 */
export function rc4(key, input, drop = 1024) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;

  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
  }

  let i = 0;
  j = 0;
  const nextByte = () => {
    i = (i + 1) & 0xff;
    j = (j + S[i]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
    return S[(S[i] + S[j]) & 0xff];
  };

  for (let n = 0; n < drop; n++) nextByte();

  const output = Buffer.alloc(input.length);
  for (let n = 0; n < input.length; n++) output[n] = input[n] ^ nextByte();
  return output;
}

/** 8 bytes aleatorios + minutos Unix (uint32 big-endian). */
export function generateNonce(now = Date.now()) {
  const nonce = Buffer.alloc(12);
  crypto.randomBytes(8).copy(nonce, 0);
  nonce.writeUInt32BE(Math.floor(now / 1000 / 60) >>> 0, 8);
  return nonce;
}

/** SHA256(base64decode(ssecurity) + nonce) */
export function generateSignedNonce(ssecurityBase64, nonce) {
  return crypto
    .createHash('sha256')
    .update(Buffer.concat([Buffer.from(ssecurityBase64, 'base64'), nonce]))
    .digest();
}

/** POST&/path&data=<v>[&rc4_hash__=<v>]&<signedNonce b64> -> SHA1 -> base64 */
export function generateSignature(method, path, form, signedNonce) {
  let value = `${method}&${path}&data=${form.data}`;
  if (Object.hasOwn(form, 'rc4_hash__')) value += `&rc4_hash__=${form.rc4_hash__}`;
  value += `&${signedNonce.toString('base64')}`;
  return crypto.createHash('sha1').update(value, 'utf8').digest('base64');
}

export function encryptValue(signedNonce, value) {
  return rc4(signedNonce, Buffer.from(String(value), 'utf8')).toString('base64');
}

export function decryptValue(signedNonce, base64Value) {
  return rc4(signedNonce, Buffer.from(String(base64Value).trim(), 'base64')).toString('utf8');
}

/**
 * Construye el formulario cifrado y firmado que espera la API de Xiaomi
 * (equivalente a Client.Request() de SmartScaleConnect).
 */
export function buildEncryptedForm(ssecurity, path, paramsJSON, nonce = generateNonce()) {
  const signedNonce = generateSignedNonce(ssecurity, nonce);

  const form = { data: paramsJSON };
  form.rc4_hash__ = generateSignature('POST', path, form, signedNonce);
  form.data = encryptValue(signedNonce, form.data);
  form.rc4_hash__ = encryptValue(signedNonce, form.rc4_hash__);
  form.signature = generateSignature('POST', path, form, signedNonce);
  form._nonce = nonce.toString('base64');

  return { form, signedNonce };
}
