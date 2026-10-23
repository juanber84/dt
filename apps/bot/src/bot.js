import { randomUUID } from 'node:crypto';
import { Bot, InlineKeyboard } from 'grammy';
import { DraftStore } from './drafts.js';
import { HELP, escapeHtml, formatAnalysis } from './format.js';

const STATUS_TEXT = {
  saved: '✅ Guardado',
  discarded: '❌ Descartado',
  replaced: '✏️ Corregido, mira la nueva propuesta',
};

const keyboard = (id) =>
  new InlineKeyboard()
    .text('✅ Guardar', `save:${id}`)
    .text('✏️ Corregir', `fix:${id}`)
    .text('❌ Descartar', `drop:${id}`);

const NO_KEYBOARD = { inline_keyboard: [] };

/**
 * Crea el bot con sus handlers (sin arrancarlo).
 * @param {object} deps
 * @param {string} deps.token
 * @param {ReturnType<typeof import('./api-client.js').createApiClient>} deps.api
 *   API de Digital Twin: estima las macros (LLM) y guarda lo confirmado.
 * @param {number[]} deps.allowedUserIds Vacío = modo configuración (solo contesta con el ID).
 * @param {string} deps.timeZone
 * @param {import('pino').Logger} deps.logger
 * @param {DraftStore} [deps.drafts]
 * @param {object} [deps.botInfo] Para tests: evita llamar a getMe.
 * @param {(fileId: string) => Promise<{ data: Uint8Array, mimeType: string }>} [deps.downloadPhoto]
 * @param {() => Date} [deps.now]
 */
export function createBot({
  token,
  api,
  allowedUserIds,
  timeZone,
  logger,
  drafts = new DraftStore(),
  botInfo,
  downloadPhoto,
  now = () => new Date(),
}) {
  const bot = new Bot(token, { botInfo });
  const allowed = new Set(allowedUserIds);

  downloadPhoto ??= async (fileId) => {
    const file = await bot.api.getFile(fileId);
    const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
    if (!response.ok) throw new Error(`No se pudo descargar la foto (${response.status})`);
    return { data: new Uint8Array(await response.arrayBuffer()), mimeType: 'image/jpeg' };
  };

  // Solo atiende a los usuarios autorizados; al resto ni se le contesta.
  // Sin ninguno configurado, le dice a cada uno su ID para que pueda ponerlo en el .env.
  bot.use(async (ctx, next) => {
    if (ctx.from && allowed.has(ctx.from.id)) return next();
    if (allowed.size === 0 && ctx.from && ctx.chat) {
      logger.info({ userId: ctx.from.id, username: ctx.from.username }, 'modo configuración');
      await ctx.reply(
        `Tu ID de Telegram es <code>${ctx.from.id}</code>.\n\n` +
          `Ponlo en <code>TELEGRAM_ALLOWED_USER_IDS</code> (apps/bot/.env) y reinicia el bot.`,
        { parse_mode: 'HTML' },
      );
      return;
    }
    logger.warn({ userId: ctx.from?.id, username: ctx.from?.username }, 'usuario no autorizado');
  });

  // El enlace de la web (t.me/<bot>?start=link-CÓDIGO) llega como "/start link-CÓDIGO"
  bot.command('start', (ctx) => {
    const payload = String(ctx.match ?? '').trim();
    if (payload.startsWith('link-')) return link(ctx, payload.slice('link-'.length));
    return ctx.reply(HELP, { parse_mode: 'HTML' });
  });
  bot.command('help', (ctx) => ctx.reply(HELP, { parse_mode: 'HTML' }));
  bot.command('vincular', (ctx) => link(ctx, String(ctx.match ?? '').trim()));

  bot.on('message:text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return ctx.reply(HELP, { parse_mode: 'HTML' });
    await handleFood(ctx, { text: ctx.message.text });
  });

  bot.on('message:photo', async (ctx) => {
    const photo = ctx.message.photo.at(-1); // la de mayor resolución
    await handleFood(ctx, { text: ctx.message.caption ?? '', photoId: photo.file_id });
  });

  bot.callbackQuery(/^(save|fix|drop):(.+)$/, async (ctx) => {
    const [, action, id] = ctx.match;
    const draft = drafts.get(id);

    if (!draft) {
      await ctx.answerCallbackQuery({ text: 'Esta propuesta ha caducado, vuelve a mandármela.' });
      await ctx.editMessageReplyMarkup({ reply_markup: NO_KEYBOARD }).catch(() => {});
      return;
    }
    if (draft.status !== 'pending') {
      return ctx.answerCallbackQuery({ text: STATUS_TEXT[draft.status] ?? 'Guardando…' });
    }

    if (action === 'save') return save(ctx, draft);

    if (action === 'fix') {
      drafts.awaitCorrection(draft.chatId, draft.id);
      await ctx.answerCallbackQuery();
      await ctx.reply(
        '✏️ Dime qué cambio, por ejemplo: <i>la leche era desnatada</i> o <i>eran 60 g de avena</i>.',
        {
          parse_mode: 'HTML',
        },
      );
      return;
    }

    draft.status = 'discarded';
    await ctx.answerCallbackQuery({ text: STATUS_TEXT.discarded });
    await closeDraft(draft);
  });

  bot.catch(({ error, ctx }) => {
    logger.error({ err: error, updateId: ctx.update.update_id }, 'error en el bot');
  });

  async function handleFood(ctx, { text, photoId }) {
    const chatId = ctx.chat.id;
    const replyTo = ctx.message.reply_to_message?.message_id;
    // Es una corrección si contesta a una propuesta o si antes pulsó ✏️
    const fromReply = replyTo !== undefined ? drafts.findByMessage(chatId, replyTo) : undefined;
    const awaiting = drafts.takeAwaiting(chatId);
    const open = fromReply?.status === 'pending' || fromReply?.status === 'asking';
    const previous = photoId ? undefined : open ? fromReply : awaiting;

    await ctx.replyWithChatAction('typing').catch(() => {});

    let analysis;
    try {
      if (previous) {
        analysis = await api.refine(previous.analysis, text);
      } else {
        const image = photoId ? await downloadPhoto(photoId) : undefined;
        analysis = await api.analyze({
          text,
          image,
          now: new Date(ctx.message.date * 1000),
          telegramUserId: ctx.from?.id,
        });
      }
    } catch (error) {
      logger.error({ err: error }, 'error analizando la comida');
      const reason = error.message;
      await ctx.reply(`⚠️ No he podido calcularlo (${escapeHtml(reason)}). Prueba otra vez.`, {
        parse_mode: 'HTML',
      });
      return;
    }

    const water = analysis.water ?? [];
    const fullText = previous ? `${previous.text}\nCorrección: ${text}` : text;

    // Le falta algo que solo sabe el usuario (cuánta agua...): se pregunta y la respuesta
    // rehace la propuesta, como una corrección
    if (analysis.question) {
      const pending = drafts.create({ chatId, text: fullText, analysis });
      drafts.awaitCorrection(chatId, pending.id);
      const sent = await ctx.reply(`💧 ${escapeHtml(analysis.question)}`, { parse_mode: 'HTML' });
      pending.messageId = sent.message_id;
      pending.status = 'asking';
      if (previous) previous.status = 'replaced';
      return;
    }

    const medications = analysis.medications ?? [];
    if (analysis.dishes.length === 0 && water.length === 0 && medications.length === 0) {
      await ctx.reply(escapeHtml(analysis.notes || 'No he encontrado comida en el mensaje.'), {
        parse_mode: 'HTML',
      });
      return;
    }

    // Cada vaso con su id desde ya: si se reintenta guardar, la API no lo duplica
    analysis.water = water.map((w) => ({ ...w, id: randomUUID() }));
    analysis.medications = medications.map((m) => ({ ...m, id: randomUUID() }));
    const draft = drafts.create({ chatId, text: fullText, analysis });
    draft.html = formatAnalysis(analysis, { timeZone, now: now() });
    const sent = await ctx.reply(draft.html, {
      parse_mode: 'HTML',
      reply_markup: keyboard(draft.id),
    });
    draft.messageId = sent.message_id;

    if (previous && previous.status !== 'asking') {
      previous.status = 'replaced';
      await closeDraft(previous);
    }
  }

  /** Vincula esta cuenta de Telegram con el usuario de la web que pidió el código. */
  async function link(ctx, code) {
    if (!code) {
      return ctx.reply(
        'Pide el código en la web: <b>Conexiones → Bot de Telegram → Vincular</b>.',
        { parse_mode: 'HTML' },
      );
    }
    try {
      const { email } = await api.linkAccount(code, {
        telegramUserId: ctx.from.id,
        username: ctx.from.username,
      });
      await ctx.reply(
        `✅ Vinculado${email ? ` con ${escapeHtml(email)}` : ''}. Ya puedes mandarme lo que comes.`,
        {
          parse_mode: 'HTML',
        },
      );
    } catch (error) {
      logger.warn({ err: error }, 'no se pudo vincular');
      await ctx.reply(`⚠️ No he podido vincularte (${escapeHtml(error.message)}).`, {
        parse_mode: 'HTML',
      });
    }
  }

  async function save(ctx, draft) {
    draft.status = 'saving'; // bloquea dobles pulsaciones mientras se guarda
    const entry = {
      id: draft.id,
      source: 'telegram',
      text: draft.text,
      notes: draft.analysis.notes,
      dishes: draft.analysis.dishes,
      createdAt: now().toISOString(),
    };

    try {
      if (entry.dishes.length) await api.saveEntry(entry, { telegramUserId: ctx.from.id });
      for (const w of draft.analysis.water ?? []) {
        await api.logEntry(
          { id: w.id, kind: 'water', at: w.drunkAt, value: w.ml },
          { telegramUserId: ctx.from.id },
        );
      }
      for (const m of draft.analysis.medications ?? []) {
        await api.logEntry(
          {
            id: m.id,
            kind: 'medication',
            at: m.takenAt,
            text: m.name,
            ...(m.dose && { dose: m.dose }),
          },
          { telegramUserId: ctx.from.id },
        );
      }
    } catch (error) {
      draft.status = 'pending';
      logger.error({ err: error, draftId: draft.id }, 'error guardando la comida');
      await ctx.answerCallbackQuery({
        text: `No se ha podido guardar: ${error.message}`.slice(0, 200),
        show_alert: true,
      });
      return;
    }

    draft.status = 'saved';
    logger.info(
      { draftId: draft.id, dishes: entry.dishes.length, water: draft.analysis.water?.length ?? 0 },
      'comida guardada',
    );
    await ctx.answerCallbackQuery({ text: STATUS_TEXT.saved });
    await closeDraft(draft);
  }

  /** Quita los botones y añade el estado final al mensaje de la propuesta. */
  async function closeDraft(draft) {
    try {
      await bot.api.editMessageText(
        draft.chatId,
        draft.messageId,
        `${draft.html}\n\n<b>${STATUS_TEXT[draft.status]}</b>`,
        { parse_mode: 'HTML', reply_markup: NO_KEYBOARD },
      );
    } catch (error) {
      logger.warn({ err: error, draftId: draft.id }, 'no se pudo actualizar la propuesta');
    }
  }

  return bot;
}
