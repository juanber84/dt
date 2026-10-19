import { createHmac } from 'node:crypto';

/**
 * Cliente de la API de Digital Twin. Toda la parte de IA vive en la API; el bot solo
 * le pasa lo que escribes y le manda lo que confirmas.
 *
 * Lo que confirmas va como evento firmado a /webhooks/digitaltwin (como cualquier otra fuente de
 * datos), con tu id de Telegram para saber de quién es. Sin `webhookSecret` se usa el endpoint
 * antiguo /nutrition/entries, que solo lo apunta en el log.
 * @param {object} options
 * @param {string} options.baseUrl p. ej. http://localhost:3000
 * @param {string} options.apiKey Clave del bot en DIGITALTWIN_API_KEYS de la API
 * @param {typeof fetch} [options.fetch]
 * @param {string} [options.webhookSecret] DIGITALTWIN_WEBHOOK_SECRET (el mismo que la API)
 * @param {number} [options.timeoutMs] El LLM puede tardar: por defecto 90 s.
 */
export function createApiClient({
  baseUrl,
  apiKey,
  webhookSecret,
  fetch = globalThis.fetch,
  timeoutMs = 90_000,
}) {
  const origin = baseUrl.replace(/\/+$/, '');
  const root = `${origin}/api/v1`;

  async function post(path, body, { timeout = timeoutMs, url = `${root}/${path}`, headers } = {}) {
    let response;
    try {
      const json = JSON.stringify(body);
      response = await fetch(url, {
        method: 'POST',
        headers: headers?.(json) ?? {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: json,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      throw new Error(`la API no responde (${error.message})`, { cause: error });
    }
    const json = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const { code, message } = json?.error ?? {};
      throw new Error(
        `API ${response.status}${code ? ` ${code}` : ''}: ${message ?? response.statusText}`,
      );
    }
    return json;
  }

  return {
    /** @param {{ text: string, image?: { data: Uint8Array, mimeType: string }, now: Date }} input */
    analyze({ text, image, now }) {
      return post('nutrition/analyze', {
        text,
        now: now.toISOString(),
        ...(image && {
          image: { base64: Buffer.from(image.data).toString('base64'), mimeType: image.mimeType },
        }),
      });
    },
    refine(previous, correction) {
      return post('nutrition/refine', { messages: previous.messages, correction });
    },
    /** @param {{ telegramUserId?: number }} [who] */
    saveEntry(entry, { telegramUserId } = {}) {
      if (webhookSecret && telegramUserId) {
        return sendEvent({ type: 'meal.logged', telegramUserId, data: entry });
      }
      return post('nutrition/entries', entry);
    },
    /** Vincula esta cuenta de Telegram con el código que da la web. */
    linkAccount(code, { telegramUserId, username }) {
      if (!webhookSecret) throw new Error('falta DIGITALTWIN_WEBHOOK_SECRET en el bot');
      return sendEvent({ type: 'account.link', telegramUserId, data: { code, username } });
    },
    /** Latido para que la API sepa que el bot está vivo (204 sin cuerpo). */
    heartbeat(info) {
      return post('heartbeat', info, { timeout: 10_000 });
    },
  };

  /** Evento firmado (HMAC-SHA256 de "<t>.<cuerpo>") a /webhooks/digitaltwin. */
  function sendEvent(event) {
    return post(null, event, {
      url: `${origin}/webhooks/digitaltwin`,
      timeout: 30_000,
      headers: (json) => ({
        'Content-Type': 'application/json',
        'X-Digitaltwin-Signature': signBody(json, webhookSecret),
      }),
    });
  }
}

/** Misma firma que comprueba la API (apps/api/src/routes/digitaltwin-webhook.routes.js). */
export function signBody(body, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}
