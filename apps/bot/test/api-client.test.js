import { describe, it, expect, vi } from 'vitest';
import { createApiClient } from '../src/api-client.js';
import { verifySignature } from '../../api/src/routes/digitaltwin-webhook.routes.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function build(response = json({ items: [], notes: '', messages: [] })) {
  const fetch = vi.fn().mockResolvedValue(response);
  const client = createApiClient({ baseUrl: 'http://api.test/', apiKey: 'tok', fetch });
  const request = (call = 0) => {
    const [url, init] = fetch.mock.calls[call];
    return { url, init, body: JSON.parse(init.body) };
  };
  return { client, request };
}

describe('createApiClient', () => {
  it('analyze manda texto, hora y foto en base64 con el token', async () => {
    const { client, request } = build();
    await client.analyze({
      text: 'avena',
      image: { data: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' },
      now: new Date('2026-10-13T12:32:00Z'),
    });
    const { url, init, body } = request();
    expect(url).toBe('http://api.test/api/v1/nutrition/analyze');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(body).toEqual({
      text: 'avena',
      now: '2026-10-13T12:32:00.000Z',
      image: { base64: 'AQID', mimeType: 'image/jpeg' },
    });
  });

  it('refine manda la conversación anterior, la corrección y de quién es', async () => {
    const { client, request } = build();
    await client.refine({ items: [], messages: [{ role: 'user', content: 'x' }] }, 'eran 60 g', {
      telegramUserId: 42,
    });
    expect(request().url).toBe('http://api.test/api/v1/nutrition/refine');
    expect(request().body).toEqual({
      messages: [{ role: 'user', content: 'x' }],
      correction: 'eran 60 g',
      telegramUserId: 42,
    });
  });

  it('saveEntry hace POST a /entries', async () => {
    const { client, request } = build(json({ id: 'x' }, 201));
    await client.saveEntry({ id: 'x' });
    expect(request().url).toBe('http://api.test/api/v1/nutrition/entries');
  });

  it('con webhookSecret, la comida va firmada a /webhooks/digitaltwin con el id de Telegram', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ status: 'routed' }, 202));
    const secret = 's'.repeat(40);
    const client = createApiClient({
      baseUrl: 'http://api.test',
      apiKey: 'tok',
      webhookSecret: secret,
      fetch,
    });
    await client.saveEntry({ id: 'x' }, { telegramUserId: 111 });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://api.test/webhooks/digitaltwin');
    expect(JSON.parse(init.body)).toEqual({
      type: 'meal.logged',
      telegramUserId: 111,
      data: { id: 'x' },
    });
    expect(init.headers.Authorization).toBeUndefined();
    // La firma es la que comprueba la API
    expect(verifySignature(init.headers['X-Digitaltwin-Signature'], init.body, secret)).toBe(true);
  });

  it('heartbeat hace POST a /heartbeat y acepta un 204', async () => {
    const { client, request } = build(new Response(null, { status: 204 }));
    await expect(client.heartbeat({ intervalMs: 60_000 })).resolves.toBeNull();
    expect(request().url).toBe('http://api.test/api/v1/heartbeat');
    expect(request().body).toEqual({ intervalMs: 60_000 });
  });

  it('convierte los errores de la API en mensajes legibles', async () => {
    const { client } = build(
      json({ error: { code: 'LLM_API_ERROR', message: 'LLM: 402: Insufficient Balance' } }, 502),
    );
    await expect(client.analyze({ text: 'x', now: new Date() })).rejects.toThrow(
      'API 502 LLM_API_ERROR: LLM: 402: Insufficient Balance',
    );
  });
});
