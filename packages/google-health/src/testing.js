import crypto from 'node:crypto';

/**
 * Utilidades para tests: genera un keyset Tink con una clave ECDSA P-256 propia y una función
 * que firma bodies igual que Google (cabecera GOOGLE-HEALTH-API-SIGNATURE).
 * Pasar `keyset` a createWebhookHandler para que confíe en ella.
 */
function varint(n) {
  const out = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return Buffer.from(out);
}

const protoField = (num, bytes) =>
  Buffer.concat([varint((num << 3) | 2), varint(bytes.length), bytes]);

export function createTestKeyset(keyId = 123456789) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const params = Buffer.from([0x08, 0x03, 0x10, 0x02, 0x18, 0x02]); // SHA256, NIST_P256, DER
  const value = Buffer.concat([
    protoField(2, params),
    protoField(3, Buffer.concat([Buffer.from([0]), Buffer.from(jwk.x, 'base64url')])),
    protoField(4, Buffer.concat([Buffer.from([0]), Buffer.from(jwk.y, 'base64url')])),
  ]);

  const keyset = {
    primaryKeyId: keyId,
    key: [
      {
        keyData: {
          typeUrl: 'type.googleapis.com/google.crypto.tink.EcdsaPublicKey',
          value: value.toString('base64'),
          keyMaterialType: 'ASYMMETRIC_PUBLIC',
        },
        status: 'ENABLED',
        keyId,
        outputPrefixType: 'TINK',
      },
    ],
  };

  const sign = (body) => {
    const prefix = Buffer.alloc(5);
    prefix[0] = 1;
    prefix.writeUInt32BE(keyId, 1);
    const signature = crypto.sign('sha256', Buffer.from(body), {
      key: privateKey,
      dsaEncoding: 'der',
    });
    return Buffer.concat([prefix, signature]).toString('base64');
  };

  return { keyset, sign };
}
