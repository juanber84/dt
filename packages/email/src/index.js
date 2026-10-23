/**
 * Tipos de correo. `test` es el botón de prueba de Cuenta (no cuenta como informe).
 */
export const KINDS = Object.freeze({
  test: { label: 'Correo de prueba' },
  'daily-report': { label: 'Informe del día' },
});

export const RESEND_URL = 'https://api.resend.com';

/**
 * Un adjunto. Con `contentId`, va incrustado en el HTML como <img src="cid:...">: así las
 * gráficas viajan dentro del correo y no hay que dejarlas en ninguna URL pública.
 * @typedef {{ filename: string, content: Uint8Array, contentId?: string }} Attachment
 */
export const DEFAULT_FROM = 'TwinMe <informe@twinme.app>';

export const EmailErrorCode = Object.freeze({
  /** Resend no acepta el correo (dirección mala, dominio sin verificar...): no se reintenta. */
  REJECTED: 'REJECTED',
  /** Límite de envío o fallo suyo o de red: se puede reintentar. */
  RETRYABLE: 'RETRYABLE',
});

export class EmailError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'EmailError';
    this.code = code;
    Object.assign(this, details);
  }

  get retryable() {
    return this.code === EmailErrorCode.RETRYABLE;
  }
}

/**
 * Envío por la API de Resend (https://resend.com/docs/api-reference/emails/send-email).
 * @param {object} options
 * @param {string} options.apiKey  Clave con permiso solo de envío (Sending access)
 * @param {string} [options.baseUrl]
 * @param {typeof fetch} [options.fetch]
 * @param {number} [options.timeoutMs]
 */
export function createResendTransport({
  apiKey,
  baseUrl = RESEND_URL,
  fetch = globalThis.fetch,
  timeoutMs = 20_000,
}) {
  return {
    /**
     * @param {{ from: string, to: string, subject: string, html: string, text: string, idempotencyKey?: string, attachments?: Attachment[] }} message
     * @returns {Promise<{ id: string }>}
     */
    async send({ from, to, subject, html, text, idempotencyKey, attachments = [] }) {
      let response;
      try {
        response = await fetch(`${baseUrl}/emails`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            // Si se reintenta el mismo correo, Resend no lo manda dos veces
            ...(idempotencyKey && { 'Idempotency-Key': idempotencyKey }),
          },
          body: JSON.stringify({
            from,
            to: [to],
            subject,
            html,
            text,
            ...(attachments.length && {
              attachments: attachments.map((a) => ({
                filename: a.filename,
                content: Buffer.from(a.content).toString('base64'),
                ...(a.contentId && { content_id: a.contentId }),
              })),
            }),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new EmailError(EmailErrorCode.RETRYABLE, `Resend no responde: ${err.message}`);
      }
      const body = await response.json().catch(() => ({}));
      if (response.ok) return { id: body.id };
      const message = `Resend ${response.status}: ${body.message ?? response.statusText}`;
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get('retry-after')) || undefined;
        throw new EmailError(EmailErrorCode.RETRYABLE, message, {
          status: response.status,
          retryAfter,
        });
      }
      throw new EmailError(EmailErrorCode.REJECTED, message, { status: response.status });
    },
  };
}

/**
 * Historial de correos en la BD (migración 0020).
 * @param {{ db: import('postgres').Sql }} deps
 */
export function createDbEmailStore({ db }) {
  return {
    /** Apunta el correo; null si ya hay uno con la misma dedupe_key que no falló. */
    async log(userId, { kind, dedupeKey, to, subject }) {
      const [row] = await db`
        insert into email_log (user_id, kind, dedupe_key, to_address, subject)
        values (${userId}, ${kind}, ${dedupeKey ?? null}, ${to}, ${subject})
        on conflict (user_id, kind, dedupe_key) where dedupe_key is not null do update
          set status = 'pending', error = null, to_address = excluded.to_address,
            subject = excluded.subject, created_at = now()
          where email_log.status = 'failed'
        returning id
      `;
      return row ? Number(row.id) : null;
    },
    async sent(id, providerId) {
      await db`
        update email_log set status = 'sent', provider_id = ${providerId}, sent_at = now()
        where id = ${id}
      `;
    },
    async failed(id, error) {
      await db`update email_log set status = 'failed', error = ${error} where id = ${id}`;
    },
    async history(userId, limit = 20) {
      const rows = await db`
        select * from email_log where user_id = ${userId} order by created_at desc limit ${limit}
      `;
      return rows.map((r) => ({
        id: Number(r.id),
        kind: r.kind,
        to: r.to_address,
        subject: r.subject,
        status: r.status,
        error: r.error,
        createdAt: r.created_at.toISOString(),
        sentAt: r.sent_at?.toISOString() ?? null,
      }));
    },
  };
}

/** Lo mismo en memoria (tests y arranque sin BD). */
export function createMemoryEmailStore() {
  const rows = [];
  return {
    rows,
    async log(userId, { kind, dedupeKey, to, subject }) {
      const same = dedupeKey
        ? rows.find((r) => r.userId === userId && r.kind === kind && r.dedupeKey === dedupeKey)
        : null;
      if (same && same.status !== 'failed') return null;
      if (same) Object.assign(same, { status: 'pending', error: null, to, subject });
      const row = same ?? { id: rows.length + 1, userId, kind, dedupeKey, to, subject };
      if (!same) rows.push({ ...row, status: 'pending' });
      return row.id;
    },
    async sent(id, providerId) {
      Object.assign(
        rows.find((r) => r.id === id),
        { status: 'sent', providerId },
      );
    },
    async failed(id, error) {
      Object.assign(
        rows.find((r) => r.id === id),
        { status: 'failed', error },
      );
    },
    async history(userId) {
      return rows.filter((r) => r.userId === userId).reverse();
    },
  };
}

// --- Plantilla -----------------------------------------------------------------------------------

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * La carcasa de todos los correos: estilos en línea (los clientes de correo no leen <style> de
 * fuera), ancho máximo de 560 px y pie con el enlace a la app. `body` ya es HTML.
 * @param {{ title: string, preheader?: string, body: string, appUrl: string }} options
 */
export function layout({ title, preheader = '', body, appUrl }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1c1a;">
<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;">
<tr><td style="padding:24px 24px 8px;font-size:13px;font-weight:600;letter-spacing:.02em;color:#6b6b66;">Twin<span style="color:#a3a39c;">Me</span></td></tr>
<tr><td style="padding:0 24px 8px;"><h1 style="margin:0;font-size:22px;line-height:1.3;">${escapeHtml(title)}</h1></td></tr>
<tr><td style="padding:8px 24px 24px;font-size:15px;line-height:1.55;">${body}</td></tr>
</table>
<p style="margin:16px 0 0;font-size:12px;color:#8a8a84;">Te llega porque lo tienes activado en <a href="${escapeHtml(appUrl)}/settings" style="color:#8a8a84;">TwinMe → Ajustes → Cuenta</a>.</p>
</td></tr>
</table>
</body>
</html>`;
}

// --- Envío con historial -------------------------------------------------------------------------

/**
 * Correos por usuario: se apuntan en el historial, se mandan y se marca cómo fue.
 * @param {object} options
 * @param {ReturnType<typeof createDbEmailStore>} options.store
 * @param {ReturnType<typeof createResendTransport>} options.transport
 * @param {string} [options.from]
 * @param {import('pino').Logger} [options.logger]
 */
export function createEmail({ store, transport, from = DEFAULT_FROM, logger }) {
  return {
    history: (userId, limit) => store.history(userId, limit),

    /**
     * @param {string} userId
     * @param {{ kind: string, to: string, subject: string, html: string, text: string, dedupeKey?: string, attachments?: Attachment[] }} email
     * @returns {Promise<{ status: 'sent', id: string } | { status: 'duplicate' }>}
     *   Lanza EmailError si falla (con `retryable` para saber si reintentar).
     */
    async send(userId, { kind, to, subject, html, text, dedupeKey, attachments }) {
      const logId = await store.log(userId, { kind, dedupeKey, to, subject });
      if (logId === null) return { status: 'duplicate' };
      try {
        const { id } = await transport.send({
          from,
          to,
          subject,
          html,
          text,
          attachments,
          idempotencyKey: `${userId}:${kind}:${dedupeKey ?? logId}`,
        });
        await store.sent(logId, id);
        logger?.info({ userId, kind, emailId: id }, 'correo enviado');
        return { status: 'sent', id };
      } catch (err) {
        await store.failed(logId, err.message);
        throw err;
      }
    },
  };
}
