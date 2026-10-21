import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLogger } from '@digitaltwin/logger';
import { createBot } from '../src/bot.js';

const USER = 111;
const CHAT = 111;
const NOW = new Date('2026-10-13T12:32:00Z');

const analysis = (name = 'Avena', kcal = 150) => ({
  dishes: [
    {
      name,
      eatenAt: '2026-10-13T06:00:00.000Z',
      items: [
        {
          name,
          quantity: 40,
          unit: 'g',
          kcal,
          proteinG: 5.3,
          carbsG: 23.6,
          fatG: 2.8,
          fiberG: 4,
        },
      ],
    },
  ],
  notes: '',
  messages: [],
});

let calls;
let nextMessageId;
let updateId;

function setup({ api, allowedUserIds = [USER] } = {}) {
  calls = [];
  nextMessageId = 100;
  updateId = 1;
  api = {
    analyze: vi.fn().mockResolvedValue(analysis()),
    refine: vi.fn().mockResolvedValue(analysis('Avena', 225)),
    saveEntry: vi.fn().mockResolvedValue({}),
    logEntry: vi.fn().mockResolvedValue({}),
    ...api,
  };

  const bot = createBot({
    token: '123:ABC',
    botInfo: { id: 1, is_bot: true, first_name: 'Bot', username: 'twin_bot' },
    api,
    allowedUserIds,
    timeZone: 'Europe/Madrid',
    logger: createLogger({ level: 'silent', pretty: false }),
    downloadPhoto: vi.fn().mockResolvedValue({ data: new Uint8Array([1]), mimeType: 'image/jpeg' }),
    now: () => NOW,
  });

  // Intercepta las llamadas a la API de Telegram
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    const result =
      method === 'sendMessage'
        ? { message_id: nextMessageId++, date: 0, chat: { id: CHAT, type: 'private' } }
        : true;
    return { ok: true, result };
  });

  return { bot, api };
}

const from = (id = USER) => ({ id, is_bot: false, first_name: 'Juan' });

function message(bot, extra, userId = USER) {
  return bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: 50 + updateId,
      date: Math.floor(NOW.getTime() / 1000),
      chat: { id: CHAT, type: 'private' },
      from: from(userId),
      ...extra,
    },
  });
}

function press(bot, data, messageId = 100) {
  return bot.handleUpdate({
    update_id: updateId++,
    callback_query: {
      id: `cb${updateId}`,
      from: from(),
      chat_instance: 'x',
      data,
      message: { message_id: messageId, date: 0, chat: { id: CHAT, type: 'private' } },
    },
  });
}

const sent = (method) => calls.filter((c) => c.method === method).map((c) => c.payload);
const buttons = (payload) =>
  payload.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
const draftId = () => buttons(sent('sendMessage').at(-1))[0].split(':')[1];

describe('bot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('analiza el texto y responde con la propuesta y los botones', async () => {
    const { bot, api } = setup();
    await message(bot, { text: 'avena 40g a las 8' });

    expect(api.analyze).toHaveBeenCalledWith({
      text: 'avena 40g a las 8',
      image: undefined,
      now: NOW,
    });
    const reply = sent('sendMessage')[0];
    expect(reply.text).toContain('<b>08:00 · Avena</b> · 40 g');
    expect(reply.text).toContain('Total: 150 kcal');
    expect(buttons(reply)).toEqual([
      expect.stringMatching(/^save:/),
      expect.stringMatching(/^fix:/),
      expect.stringMatching(/^drop:/),
    ]);
  });

  it('ignora a usuarios no autorizados', async () => {
    const { bot, api } = setup();
    await message(bot, { text: 'hola' }, 999);
    expect(api.analyze).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('sin IDs configurados solo contesta a cada uno con su ID', async () => {
    const { bot, api } = setup({ allowedUserIds: [] });
    await message(bot, { text: 'avena' }, 999);
    expect(api.analyze).not.toHaveBeenCalled();
    expect(sent('sendMessage')[0].text).toContain('<code>999</code>');
  });

  it('vincular: el enlace de la web (/start link-CÓDIGO) o /vincular CÓDIGO', async () => {
    const linkAccount = vi.fn().mockResolvedValue({ linked: true, email: 'yo@x.com' });
    const { bot, api } = setup({ api: { linkAccount } });
    const command = (text) =>
      message(bot, {
        text,
        entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }],
      });

    await command('/start link-ABCD2345');
    await command('/vincular WXYZ6789');
    await command('/vincular');
    await command('/start');
    expect(api.linkAccount.mock.calls).toEqual([
      ['ABCD2345', { telegramUserId: USER, username: undefined }],
      ['WXYZ6789', { telegramUserId: USER, username: undefined }],
    ]);
    const texts = sent('sendMessage').map((m) => m.text);
    expect(texts[0]).toContain('✅ Vinculado con yo@x.com');
    expect(texts[2]).toContain('Conexiones → Bot de Telegram → Vincular');
    expect(texts[3]).toContain('Cuéntame lo que comes');
  });

  it('guardar envía la entrada a la API, quita los botones y no duplica', async () => {
    const { bot, api } = setup();
    await message(bot, { text: 'avena' });
    const id = draftId();

    await press(bot, `save:${id}`);
    await press(bot, `save:${id}`);

    expect(api.saveEntry).toHaveBeenCalledTimes(1);
    expect(api.saveEntry).toHaveBeenCalledWith(
      {
        id,
        source: 'telegram',
        text: 'avena',
        notes: '',
        dishes: analysis().dishes,
        createdAt: NOW.toISOString(),
      },
      { telegramUserId: USER },
    );
    const edit = sent('editMessageText')[0];
    expect(edit).toMatchObject({ chat_id: CHAT, message_id: 100 });
    expect(edit.text).toContain('✅ Guardado');
    expect(edit.reply_markup).toEqual({ inline_keyboard: [] });
    expect(sent('answerCallbackQuery').at(-1).text).toBe('✅ Guardado');
  });

  it('si la API falla, avisa y deja la propuesta pendiente para reintentar', async () => {
    const saveEntry = vi.fn().mockRejectedValueOnce(new Error('API 503')).mockResolvedValue({});
    const { bot, api } = setup({ api: { saveEntry } });
    await message(bot, { text: 'avena' });
    const id = draftId();

    await press(bot, `save:${id}`);
    expect(sent('answerCallbackQuery')[0]).toMatchObject({ show_alert: true });
    expect(sent('editMessageText')).toEqual([]);

    await press(bot, `save:${id}`);
    expect(api.saveEntry).toHaveBeenCalledTimes(2);
    expect(sent('editMessageText')[0].text).toContain('✅ Guardado');
  });

  it('corregir: pide el cambio, recalcula y cierra la propuesta anterior', async () => {
    const { bot, api } = setup();
    await message(bot, { text: 'avena' });
    const first = draftId();

    await press(bot, `fix:${first}`);
    await message(bot, { text: 'eran 60 g' });

    expect(api.refine).toHaveBeenCalledWith({ ...analysis(), water: [] }, 'eran 60 g');
    const proposal = sent('sendMessage').at(-1);
    expect(proposal.text).toContain('Total: 225 kcal');
    expect(sent('editMessageText')[0].text).toContain('Corregido');

    // La anterior ya no se puede guardar; la nueva sí, con el texto completo
    await press(bot, `save:${first}`);
    expect(api.saveEntry).not.toHaveBeenCalled();
    await press(bot, `save:${draftId()}`, 102);
    expect(api.saveEntry.mock.calls[0][0].text).toBe('avena\nCorrección: eran 60 g');
  });

  it('contestar a la propuesta también cuenta como corrección', async () => {
    const { bot, api } = setup();
    await message(bot, { text: 'avena' });
    await message(bot, {
      text: 'con leche',
      reply_to_message: { message_id: 100, date: 0, chat: { id: CHAT, type: 'private' } },
    });
    expect(api.refine).toHaveBeenCalledTimes(1);
    expect(api.analyze).toHaveBeenCalledTimes(1);
  });

  it('descartar quita los botones', async () => {
    const { bot, api } = setup();
    await message(bot, { text: 'avena' });
    await press(bot, `drop:${draftId()}`);
    expect(sent('editMessageText')[0].text).toContain('❌ Descartado');
    expect(api.saveEntry).not.toHaveBeenCalled();
  });

  it('avisa si la propuesta ha caducado (p. ej. tras reiniciar)', async () => {
    const { bot } = setup();
    await press(bot, 'save:no-existe');
    expect(sent('answerCallbackQuery')[0].text).toMatch(/caducado/);
    expect(sent('editMessageReplyMarkup')[0].reply_markup).toEqual({ inline_keyboard: [] });
  });

  it('manda la foto al modelo', async () => {
    const { bot, api } = setup();
    await message(bot, {
      caption: 'mi comida',
      photo: [
        { file_id: 'small', file_unique_id: 's', width: 90, height: 90 },
        { file_id: 'big', file_unique_id: 'b', width: 1280, height: 1280 },
      ],
    });
    expect(api.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'mi comida', image: expect.any(Object) }),
    );
  });

  it('si el mensaje no es comida, contesta con la nota del modelo sin botones', async () => {
    const analyze = vi
      .fn()
      .mockResolvedValue({ dishes: [], notes: '¿Qué has comido?', messages: [] });
    const { bot } = setup({ api: { analyze } });
    await message(bot, { text: 'hola' });
    expect(sent('sendMessage')[0].text).toBe('¿Qué has comido?');
    expect(sent('sendMessage')[0].reply_markup).toBeUndefined();
  });

  it('informa de errores de la API', async () => {
    const analyze = vi
      .fn()
      .mockRejectedValue(new Error('API 502 LLM_API_ERROR: LLM: 402: Insufficient Balance'));
    const { bot } = setup({ api: { analyze } });
    await message(bot, { text: 'avena' });
    expect(sent('sendMessage')[0].text).toContain('402: Insufficient Balance');
  });

  describe('agua', () => {
    const water = (ml, extra = {}) => ({
      dishes: [],
      water: [{ ml, drunkAt: '2026-10-13T12:30:00.000Z' }],
      question: '',
      notes: '',
      messages: [],
      ...extra,
    });

    it('con cantidad: propuesta solo de agua y al guardar va como registro, no como comida', async () => {
      const { bot, api } = setup({ api: { analyze: vi.fn().mockResolvedValue(water(500)) } });
      await message(bot, { text: 'medio litro de agua' });
      const reply = sent('sendMessage')[0];
      expect(reply.text).toContain('💧 <b>14:30 · Agua</b> · 500 ml');
      expect(reply.text).not.toContain('Total');

      await press(bot, `save:${draftId()}`);
      expect(api.saveEntry).not.toHaveBeenCalled();
      expect(api.logEntry).toHaveBeenCalledWith(
        { id: expect.any(String), kind: 'water', at: '2026-10-13T12:30:00.000Z', value: 500 },
        { telegramUserId: USER },
      );
    });

    it('sin cantidad pregunta, y la respuesta completa la propuesta', async () => {
      const { bot, api } = setup({
        api: {
          analyze: vi.fn().mockResolvedValue(water(null, { question: '¿Cuánta agua has bebido?' })),
          refine: vi.fn().mockResolvedValue(water(250)),
        },
      });
      await message(bot, { text: 'he bebido agua' });
      expect(sent('sendMessage')[0].text).toBe('💧 ¿Cuánta agua has bebido?');
      expect(sent('sendMessage')[0].reply_markup).toBeUndefined();

      await message(bot, { text: 'un vaso' });
      expect(api.refine).toHaveBeenCalledWith(expect.anything(), 'un vaso');
      expect(sent('sendMessage')[1].text).toContain('· Agua</b> · 250 ml');
      expect(buttons(sent('sendMessage')[1])[0]).toMatch(/^save:/);
    });

    it('comida y agua juntas: cada una por su lado', async () => {
      const both = { ...analysis(), water: [{ ml: 250, drunkAt: '2026-10-13T06:00:00.000Z' }] };
      const { bot, api } = setup({ api: { analyze: vi.fn().mockResolvedValue(both) } });
      await message(bot, { text: 'avena y un vaso de agua' });
      await press(bot, `save:${draftId()}`);
      expect(api.saveEntry).toHaveBeenCalledTimes(1);
      expect(api.logEntry).toHaveBeenCalledTimes(1);
    });
  });
});
