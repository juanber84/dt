import { createHash, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../utils/http-error.js';

const digest = (value) => createHash('sha256').update(value).digest();

/**
 * Exige `Authorization: Bearer <clave>` con una de las API keys configuradas (comparación en
 * tiempo constante). Deja el nombre del cliente en `req.apiClient` y en los logs.
 * @param {{ client: string, key: string }[]} keys
 */
export function apiKeyAuth(keys) {
  const known = keys.map(({ client, key }) => ({ client, digest: digest(key) }));

  return (req, _res, next) => {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    const received = match && digest(match[1]);
    // Recorre todas las claves aunque ya haya coincidido una (no filtra cuál es por el tiempo)
    let client;
    for (const entry of known) {
      if (received && timingSafeEqual(received, entry.digest)) client ??= entry.client;
    }
    if (!client) return next(HttpError.unauthorized('API key no válida'));

    req.apiClient = client;
    req.log = req.log?.child({ client }) ?? req.log;
    next();
  };
}
