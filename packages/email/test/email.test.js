import { describe, it, expect, vi } from 'vitest';
import {
  createEmail,
  createMemoryEmailStore,
  createResendTransport,
  EmailError,
  EmailErrorCode,
  escapeHtml,
  layout,
} from '../src/index.js';

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const message = {
  from: 'TwinMe <informe@twinme.app>',
  to: 'yo@example.com',
  subject: 'Hola',
  html: '<p>Hola</p>',
  text: 'Hola',
};

describe('createResendTransport', () => {
  it('manda a /emails con la clave y la clave de idempotencia', async () => {
    const fetch = vi.fn(async () => json({ id: 'em_1' }));
    const transport = createResendTransport({ apiKey: 're_test', fetch });

    expect(await transport.send({ ...message, idempotencyKey: 'u1:test:1' })).toEqual({
      id: 'em_1',
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer re_test',
      'Idempotency-Key': 'u1:test:1',
    });
    expect(JSON.parse(init.body)).toEqual({
      from: message.from,
      to: ['yo@example.com'],
      subject: 'Hola',
      html: '<p>Hola</p>',
      text: 'Hola',
    });
  });

  it('adjuntos en base64; con contentId van incrustados (cid)', async () => {
    const fetch = vi.fn(async () => json({ id: 'em_1' }));
    const transport = createResendTransport({ apiKey: 're_test', fetch });
    await transport.send({
      ...message,
      attachments: [{ filename: 'chart-1.png', content: Buffer.from('png'), contentId: 'chart-1' }],
    });
    expect(JSON.parse(fetch.mock.calls[0][1].body).attachments).toEqual([
      {
        filename: 'chart-1.png',
        content: Buffer.from('png').toString('base64'),
        content_id: 'chart-1',
      },
    ]);
  });

  it('límite (429), fallo suyo (5xx) o de red: se puede reintentar', async () => {
    const limited = createResendTransport({
      apiKey: 're_test',
      fetch: async () => json({ message: 'Too many requests' }, 429, { 'retry-after': '30' }),
    });
    await expect(limited.send(message)).rejects.toMatchObject({
      code: EmailErrorCode.RETRYABLE,
      retryable: true,
      retryAfter: 30,
    });

    const down = createResendTransport({ apiKey: 're_test', fetch: async () => json({}, 503) });
    await expect(down.send(message)).rejects.toMatchObject({ retryable: true, status: 503 });

    const offline = createResendTransport({
      apiKey: 're_test',
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(offline.send(message)).rejects.toMatchObject({ retryable: true });
  });

  it('si lo rechaza (dominio sin verificar, dirección mala), no se reintenta', async () => {
    const transport = createResendTransport({
      apiKey: 're_test',
      fetch: async () => json({ message: 'The twinme.app domain is not verified' }, 403),
    });
    const error = await transport.send(message).catch((e) => e);
    expect(error).toBeInstanceOf(EmailError);
    expect(error).toMatchObject({ code: EmailErrorCode.REJECTED, retryable: false, status: 403 });
    expect(error.message).toContain('not verified');
  });
});

describe('createEmail', () => {
  const setup = (send = vi.fn(async () => ({ id: 'em_1' }))) => {
    const store = createMemoryEmailStore();
    const email = createEmail({ store, transport: { send }, from: 'TwinMe <informe@twinme.app>' });
    return { store, email, send };
  };
  const report = {
    kind: 'daily-report',
    to: 'yo@example.com',
    subject: 'Ayer',
    html: '',
    text: '',
  };

  it('apunta, manda y marca como enviado', async () => {
    const { store, email, send } = setup();
    expect(await email.send('u1', { ...report, dedupeKey: '2026-10-22' })).toEqual({
      status: 'sent',
      id: 'em_1',
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'TwinMe <informe@twinme.app>',
        to: 'yo@example.com',
        idempotencyKey: 'u1:daily-report:2026-10-22',
      }),
    );
    expect(store.rows).toMatchObject([{ status: 'sent', providerId: 'em_1' }]);
  });

  it('el mismo informe (misma dedupeKey) no sale dos veces', async () => {
    const { email, send } = setup();
    await email.send('u1', { ...report, dedupeKey: '2026-10-22' });
    expect(await email.send('u1', { ...report, dedupeKey: '2026-10-22' })).toEqual({
      status: 'duplicate',
    });
    expect(send).toHaveBeenCalledTimes(1);
    // Otro día u otro usuario, sí
    await email.send('u1', { ...report, dedupeKey: '2026-10-23' });
    await email.send('u2', { ...report, dedupeKey: '2026-10-22' });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('si falla queda como fallido y se puede volver a intentar', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new EmailError(EmailErrorCode.RETRYABLE, 'Resend 503'))
      .mockResolvedValueOnce({ id: 'em_2' });
    const { store, email } = setup(send);

    await expect(email.send('u1', { ...report, dedupeKey: 'd' })).rejects.toThrow('Resend 503');
    expect(store.rows[0]).toMatchObject({ status: 'failed', error: 'Resend 503' });

    expect(await email.send('u1', { ...report, dedupeKey: 'd' })).toEqual({
      status: 'sent',
      id: 'em_2',
    });
    expect(store.rows).toHaveLength(1);
  });
});

describe('layout', () => {
  it('escapa el título y enlaza a Cuenta en el pie', () => {
    const html = layout({
      title: 'Peso <72 kg> & más',
      body: '<p>ya en HTML</p>',
      appUrl: 'https://twinme.app',
    });
    expect(html).toContain('Peso &lt;72 kg&gt; &amp; más');
    expect(html).toContain('<p>ya en HTML</p>');
    expect(html).toContain('https://twinme.app/settings');
  });

  it('escapeHtml también escapa comillas (para atributos)', () => {
    expect(escapeHtml('"a" & <b>')).toBe('&quot;a&quot; &amp; &lt;b&gt;');
  });
});
