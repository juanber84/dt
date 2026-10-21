import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createDb, migrate } from '@digitaltwin/db';
import { createDbUserStore } from '../src/services/users-db.js';
import { createDbConnectionStore, createSecretBox } from '@digitaltwin/connections';
import { createDbCoachStore } from '../src/services/coach-store.js';
import { createDbLlmUsageRows, createLlmUsage, parsePrices } from '../src/services/llm-usage.js';
import { buildExtraction, createDbClinicalStore, modelOutputSchema } from '@digitaltwin/clinical';
import { createDbPasskeyStore } from '../src/services/passkeys.js';
import { createDbPushStore, createPush } from '@digitaltwin/push';

// Necesita una BD de verdad (make test-db). Cada ejecución usa un schema propio que se borra al final.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('stores en la BD', () => {
  const schema = `test_${randomBytes(4).toString('hex')}`;
  const key = randomBytes(32).toString('hex');
  let admin;
  let db;
  let users;
  let connections;
  let me;

  beforeAll(async () => {
    admin = createDb(url, { max: 1 });
    await admin.unsafe(`create schema ${schema}`);
    db = createDb(url, { connection: { search_path: `${schema},public` } });
    await migrate(db);
    users = createDbUserStore({ db });
    connections = createDbConnectionStore({ db, box: createSecretBox(key) });
    ({ user: me } = await users.upsert({
      email: 'Yo@Example.com',
      name: 'Yo',
      role: 'admin',
      password: 'patata',
    }));
  });

  afterAll(async () => {
    await db?.end();
    await admin?.unsafe(`drop schema if exists ${schema} cascade`);
    await admin?.end();
  });

  describe('usuarios', () => {
    it('crea, verifica la contraseña (email sin distinguir mayúsculas) y busca por id', async () => {
      expect(me).toMatchObject({ email: 'Yo@Example.com', role: 'admin' });
      expect(await users.verify(' yo@example.com', 'patata')).toMatchObject({ id: me.id });
      expect(await users.verify('yo@example.com', 'otra')).toBeNull();
      expect(await users.verify('nadie@example.com', 'patata')).toBeNull();
      expect(await users.findById(me.id)).toMatchObject({ email: 'Yo@Example.com' });
      expect(await users.findById('juanber')).toBeNull();
    });

    it('upsert con un email existente actualiza en vez de duplicar', async () => {
      const { user, created } = await users.upsert({
        email: 'yo@example.com',
        name: 'Yo de nuevo',
        role: 'admin',
        password: 'nueva',
      });
      expect(created).toBe(false);
      expect(user.id).toBe(me.id);
      expect(await users.verify('yo@example.com', 'nueva')).not.toBeNull();
      await users.upsert({
        email: 'yo@example.com',
        name: 'Yo',
        role: 'admin',
        password: 'patata',
      });
    });
  });

  describe('conexiones', () => {
    const xiaomi = () => ({
      userId: me.id,
      provider: 'xiaomi',
      status: 'connected',
      account: 'yo@example.com',
      region: 'de',
      details: { devices: [{ name: 'Báscula', model: 'yunmai.scales.ms104' }] },
      connectedAt: '2026-10-15T08:00:00.000Z',
      credentials: { userId: '42', serviceToken: 'token-secreto', ssecurity: 'ss' },
    });

    it('guarda y lee: lo común en columnas, lo del conector en data y las credenciales cifradas', async () => {
      await connections.save(xiaomi());
      expect(await connections.get(me.id, 'xiaomi')).toMatchObject({
        ...xiaomi(),
        lastSync: undefined,
      });

      const [row] = await db`select * from connections where user_id = ${me.id}`;
      expect(row.data).toEqual({ region: 'de', details: xiaomi().details });
      expect(row.credentials.toString('latin1')).not.toContain('token-secreto');
    });

    it('save actualiza (sincronización, error) y list solo trae las del usuario', async () => {
      await connections.save({
        ...xiaomi(),
        lastSync: '2026-10-15T09:00:00.000Z',
        records: 9,
        lastRecord: { at: '2026-10-13T05:06:18.000Z', weight: 82.4 },
      });
      const saved = await connections.get(me.id, 'xiaomi');
      expect(saved).toMatchObject({ lastSync: '2026-10-15T09:00:00.000Z', records: 9 });
      expect((await connections.list(me.id)).map((c) => c.provider)).toEqual(['xiaomi']);

      const { user: other } = await users.upsert({
        email: 'otra@example.com',
        role: 'user',
        password: 'patata',
      });
      expect(await connections.list(other.id)).toEqual([]);
      expect(await connections.get(other.id, 'xiaomi')).toBeNull();
    });

    it('con otra clave las credenciales no se leen y la conexión queda para reconectar', async () => {
      const otherKey = createDbConnectionStore({
        db,
        box: createSecretBox(randomBytes(32).toString('hex')),
      });
      expect(await otherKey.get(me.id, 'xiaomi')).toMatchObject({
        status: 'expired',
        credentials: null,
      });
    });

    it('las credenciales de una fila copiadas a otra no valen (contexto autenticado)', async () => {
      const { user: other } = await users.upsert({
        email: 'copia@example.com',
        role: 'user',
        password: 'patata',
      });
      await db`
        insert into connections (user_id, provider, credentials)
        select ${other.id}, provider, credentials from connections where user_id = ${me.id}
      `;
      expect((await connections.get(other.id, 'xiaomi')).credentials).toBeNull();
    });

    it('remove borra y dice si había algo', async () => {
      expect(await connections.remove(me.id, 'xiaomi')).toBe(true);
      expect(await connections.remove(me.id, 'xiaomi')).toBe(false);
      expect(await connections.get(me.id, 'xiaomi')).toBeNull();
    });
  });

  describe('coach y consumo de LLM', () => {
    it('conversaciones: mensajes en orden con herramientas, solo para su dueño', async () => {
      const coach = createDbCoachStore({ db });
      const c = await coach.create({ userId: me.id, title: '¿Peso?' });
      await coach.addMessage(c.id, {
        role: 'user',
        content: '¿Peso?',
        meta: { context: { date: '2026-10-16' } },
      });
      const calls = [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }];
      await coach.addMessage(c.id, { role: 'assistant', content: '', toolCalls: calls });
      await coach.addMessage(c.id, { role: 'tool', content: '{"ok":1}', toolCallId: 'c1' });

      const saved = await coach.get(me.id, c.id);
      expect(saved.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
      expect(saved.messages[0].meta).toEqual({ context: { date: '2026-10-16' } });
      expect(saved.messages[1].toolCalls).toEqual(calls);
      expect(saved.messages[2].toolCallId).toBe('c1');
      expect((await coach.list(me.id)).map((x) => x.id)).toEqual([c.id]);

      const { user: other } = await users.upsert({
        email: 'otro@example.com',
        role: 'user',
        password: 'x',
      });
      expect(await coach.get(other.id, c.id)).toBeNull();
      expect(await coach.remove(other.id, c.id)).toBe(false);
      expect(await coach.remove(me.id, c.id)).toBe(true);
    });

    it('consumo: se apunta con su coste y sale en el resumen', async () => {
      const usage = createLlmUsage({
        rows: createDbLlmUsageRows({ db }),
        prices: parsePrices('deepseek-flash:0.28/0.028/0.42'),
        timeZone: 'Europe/Madrid',
      });
      await usage.record({
        feature: 'nutrition.analyze',
        model: 'deepseek-flash',
        usage: { prompt_tokens: 2000, prompt_cache_hit_tokens: 1000, completion_tokens: 500 },
        durationMs: 1200,
      });
      await usage.record({
        feature: 'coach',
        model: 'deepseek-flash',
        usage: null,
        error: 'boom',
        userId: me.id,
      });

      const summary = await usage.summary();
      expect(summary.today).toMatchObject({ calls: 2, errors: 1 });
      // 1000 × 0,28 + 1000 × 0,028 + 500 × 0,42, por millón
      expect(summary.today.costUsd).toBeCloseTo(0.000518, 9);
      expect(summary.recent[0]).toMatchObject({ feature: 'coach', error: 'boom', userId: me.id });
      expect(summary.recent[1]).toMatchObject({
        inputTokens: 2000,
        cachedTokens: 1000,
        outputTokens: 500,
      });
    });
  });
  describe('informes clínicos', () => {
    const pdf = Buffer.from('%PDF-1.4 informe de prueba');
    const text = 'Fecha: 07/10/2026\nCreatinina 1.41 mg/dl';
    const extraction = buildExtraction(
      modelOutputSchema.parse({
        type: 'lab',
        title: 'Analítica',
        date: '2026-10-07',
        items: [{ name: 'Creatinina', value_text: '1.41', value: 1.41, unit: 'mg/dl' }],
      }),
      text,
    );

    it('guarda el PDF una sola vez, lo lee, se revisa, se confirma y se borra', async () => {
      const store = createDbClinicalStore({ db });
      const { document, created } = await store.create({
        userId: me.id,
        fileName: 'a.pdf',
        data: pdf,
        requestedDate: '2026-10-18',
      });
      expect(created).toBe(true);
      expect(document).toMatchObject({
        status: 'processing',
        fileName: 'a.pdf',
        sizeBytes: pdf.length,
        requestedDate: '2026-10-18',
      });
      const again = await store.create({ userId: me.id, fileName: 'b.pdf', data: pdf });
      expect(again).toMatchObject({ created: false, document: { id: document.id } });

      const claimed = await store.claim(document.id);
      expect(claimed).toMatchObject({
        userId: me.id,
        status: 'processing',
        requestedDate: '2026-10-18',
      });
      expect(Buffer.from(claimed.data).equals(pdf)).toBe(true);
      await store.saveExtraction(document.id, { text, redactions: 2, extraction });

      const detail = await store.get(me.id, document.id);
      expect(detail).toMatchObject({
        status: 'review',
        type: 'lab',
        date: '2026-10-07',
        text,
        redactions: 2,
        counts: { items: 1 },
      });
      expect(detail.extraction.items[0]).toMatchObject({
        metric: 'lab.creatinine',
        metricValue: 1.41,
      });
      expect(await store.get('00000000-0000-4000-8000-000000000000', document.id)).toBeNull();

      const confirmed = await store.confirm(me.id, document.id);
      expect(confirmed.status).toBe('confirmed');
      expect(await store.confirmed(me.id)).toHaveLength(1);
      // Editar uno confirmado lo devuelve a revisión hasta confirmarlo otra vez
      const edited = await store.updateExtraction(me.id, document.id, {
        ...extraction,
        title: 'Otra',
      });
      expect(edited).toMatchObject({ status: 'review', title: 'Otra' });

      expect(await store.list(me.id)).toHaveLength(1);
      expect(await store.remove(me.id, document.id)).toMatchObject({ id: document.id });
      expect(await store.list(me.id)).toEqual([]);
    });

    it('alias por usuario y el nombre para quitarlo del texto', async () => {
      const store = createDbClinicalStore({ db });
      await store.saveAliases(me.id, [['Antígeno RARO', 'lab.crp']]);
      await store.saveAliases(me.id, [['antigeno raro', 'lab.ferritin']]);
      expect(await store.aliases(me.id)).toEqual(new Map([['antigeno raro', 'lab.ferritin']]));
      expect(await store.userNames(me.id)).toEqual(['Yo', 'Yo']);
    });
  });

  describe('passkeys', () => {
    it('guarda la clave pública, apunta el uso y solo la borra su dueño', async () => {
      const store = createDbPasskeyStore({ db });
      await store.save({
        id: 'cred-abc',
        userId: me.id,
        publicKey: new Uint8Array([1, 2, 3, 250]),
        counter: 0,
        transports: ['internal', 'hybrid'],
        deviceType: 'multiDevice',
        backedUp: true,
        name: 'iPhone',
      });
      const saved = await store.get('cred-abc');
      expect(saved).toMatchObject({
        userId: me.id,
        counter: 0,
        transports: ['internal', 'hybrid'],
      });
      expect([...saved.publicKey]).toEqual([1, 2, 3, 250]);
      await store.used('cred-abc', 5);
      expect(await store.get('cred-abc')).toMatchObject({
        counter: 5,
        lastUsedAt: expect.any(String),
      });
      expect(await store.remove('00000000-0000-0000-0000-000000000000', 'cred-abc')).toBe(false);
      expect(await store.listByUser(me.id)).toHaveLength(1);
      expect(await store.remove(me.id, 'cred-abc')).toBe(true);
      expect(await store.get('cred-abc')).toBeNull();
    });
  });

  describe('avisos push', () => {
    it('suscripciones, preferencias, sin repetir y borra los dispositivos que ya no existen', async () => {
      const store = createDbPushStore({ db });
      const send = async (sub) => {
        if (sub.endpoint.endsWith('/muerto'))
          throw Object.assign(new Error('Gone'), { statusCode: 410 });
      };
      const push = createPush({
        store,
        vapid: { publicKey: 'p', privateKey: 'k', subject: 'https://dt.example.com' },
        send,
        // Mediodía en Madrid: fuera de las horas de silencio
        now: () => new Date('2026-10-21T10:00:00Z'),
      });
      const keys = { p256dh: 'a', auth: 'b' };
      await push.subscribe(me.id, { endpoint: 'https://push.example/vivo', keys }, 'iPhone');
      await push.subscribe(me.id, { endpoint: 'https://push.example/muerto', keys }, 'Mac');
      expect(await push.subscribedUsers()).toContain(me.id);
      expect(await push.settings(me.id)).toMatchObject({ quietFrom: '22:00', maxPerDay: 6 });
      await push.updateSettings(me.id, { quietFrom: '23:30', disabled: ['connection-broken'] });
      expect(await push.settings(me.id)).toMatchObject({
        quietFrom: '23:30',
        disabled: ['connection-broken'],
      });

      const n = { kind: 'meals-missing', title: 'Sin comidas', dedupeKey: '2026-10-21' };
      expect(await push.notify(me.id, n)).toEqual({ status: 'sent', delivered: 1 });
      expect(await push.notify(me.id, n)).toEqual({ status: 'duplicate' });
      expect((await push.devices(me.id)).map((d) => d.device)).toEqual(['iPhone']);
      expect(await push.history(me.id)).toMatchObject([{ kind: 'meals-missing', delivered: 1 }]);
    });
  });
});
