import { Router } from 'express';
import { z } from 'zod';
import { buildContext, createChartTool } from '@digitaltwin/coach';
import { createTools } from '@digitaltwin/mcp';
import { StrengthError, StrengthErrorCode } from '@digitaltwin/strength';
import { validate } from '../middlewares/validate.js';
import { HttpError } from '../utils/http-error.js';
import { titleFrom, toModelHistory } from '../services/coach-store.js';

const idParams = z.object({ id: z.uuid() });
const messageParams = z.object({ id: z.string().regex(/^\d+$/) });
const messageBody = z.object({
  /** Sin él, empieza una conversación nueva. */
  conversationId: z.uuid().optional(),
  text: z.string().trim().min(1).max(4000),
  /** Desde dónde se pregunta (el día que está mirando en la app). */
  context: z
    .object({
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    })
    .optional(),
});

/** Comentario SSE cada tanto: que nginx y el navegador no den la conexión por muerta. */
const PING_MS = 15_000;

/**
 * /api/v1/coach: conversaciones con el coach del usuario de la sesión.
 *   GET    /conversations       las suyas, la más reciente primero
 *   GET    /conversations/:id   una con sus mensajes
 *   DELETE /conversations/:id
 *   POST   /messages            { conversationId?, text, context? } → stream SSE:
 *     conversation { id, title, created } · user (el mensaje guardado) · tool { id, name, args } ·
 *     tool_result { id, ok, display? } (display: una gráfica de show_chart) · delta { text } ·
 *     display { id, toolCallId } (el mensaje guardado de una tarjeta, para su botón) ·
 *     message (cada mensaje del asistente guardado) ·
 *     done { message } | error { message }
 *   POST   /messages/:id/apply  guarda en su app la plantilla de fuerza que propuso el coach en
 *     ese mensaje (la que está guardada, no lo que mande el navegador) → { display }
 *
 * @param {object} deps
 * @param {(llm: object) => ReturnType<typeof import('@digitaltwin/coach').createCoach>} deps.newCoach
 * @param {ReturnType<typeof import('../services/ai.js').createAi>} deps.ai  El LLM de cada usuario.
 * @param {ReturnType<typeof import('../services/coach-store.js').createMemoryCoachStore>} deps.store
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createTimelineQueries>} deps.queries
 * @param {string} deps.timeZone
 * @param {ReturnType<typeof import('../services/ai-tools.js').createAiTools>} deps.aiTools
 *   Sus herramientas: las mismas que las del MCP (las de fuerza proponen en vez de escribir).
 * @param {ReturnType<typeof import('../services/strength-apps.js').createStrengthApps>} [deps.strengthApps]
 *   Para guardar lo que proponga en sus apps de fuerza.
 * @param {ReturnType<typeof import('../services/llm-usage.js').createLlmUsage>} [deps.usage]
 */
export function createCoachRouter({
  newCoach,
  ai,
  store,
  queries,
  supplements,
  engine,
  timeZone,
  aiTools,
  strengthApps,
  usage,
}) {
  const router = Router();

  router.get('/conversations', async (req, res) => {
    res.json({ items: await store.list(req.user.id) });
  });

  router.get('/conversations/:id', validate({ params: idParams }), async (req, res) => {
    const conversation = await store.get(req.user.id, req.validated.params.id);
    if (!conversation) throw HttpError.notFound('No existe esa conversación');
    res.json(conversation);
  });

  router.delete('/conversations/:id', validate({ params: idParams }), async (req, res) => {
    const removed = await store.remove(req.user.id, req.validated.params.id);
    if (!removed) throw HttpError.notFound('No existe esa conversación');
    res.status(204).end();
  });

  router.post('/messages', validate({ body: messageBody }), async (req, res) => {
    const { conversationId, text, context } = req.validated.body;
    const userId = req.user.id;

    // Lo que puede fallar con un error normal va antes de abrir el stream
    let conversation = conversationId && (await store.get(userId, conversationId));
    if (conversationId && !conversation) throw HttpError.notFound('No existe esa conversación');
    // Su clave o la de la app (429 si ya ha gastado lo de hoy)
    const { llm, own } = await ai.chat(userId);
    const coach = newCoach(llm);
    conversation ||= await store.create({ userId, title: titleFrom(text) });
    const question = await store.addMessage(conversation.id, {
      role: 'user',
      content: text,
      ...(context?.date && { meta: { context } }),
    });

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform: compression no lo comprime (lo retendría); X-Accel-Buffering: nginx tampoco
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);

    // Si cierra la pestaña a medias, se corta el modelo (y se deja de pagar)
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    send('conversation', {
      id: conversation.id,
      title: conversation.title,
      created: !conversationId,
    });
    send('user', question);

    // Las mismas del MCP (las de fuerza, proponiendo) y show_chart, que solo tiene sentido aquí
    const deps = await aiTools.depsFor(userId, { surface: 'coach' });
    const { getProfile } = deps;
    const tools = createTools(deps);
    const getSeries = tools.find((tool) => tool.name === 'get_series').handler;
    tools.push(createChartTool({ getSeries }));

    try {
      const final = await coach.run({
        history: toModelHistory([...conversation.messages, question]),
        tools,
        userName: req.user.name ?? undefined,
        context: await coachContext({ queries, userId, getProfile, supplements, engine, timeZone }),
        signal: abort.signal,
        onEvent: ({ type, ...data }) => send(type, data),
        onMessage: async (message) => {
          const saved = await store.addMessage(conversation.id, {
            role: message.role,
            content: message.content,
            toolCalls: message.tool_calls,
            toolCallId: message.tool_call_id,
            // La gráfica se guarda para volver a pintarla al abrir la conversación
            ...(message.display && { meta: { display: message.display } }),
          });
          if (saved.role === 'assistant') send('message', saved);
          // Una tarjeta necesita su mensaje guardado para el botón
          if (saved.role === 'tool' && saved.meta?.display) {
            send('display', { id: saved.id, toolCallId: saved.toolCallId });
          }
        },
        onUsage: (entry) =>
          usage?.record({
            ...entry,
            feature: 'coach',
            userId,
            conversationId: conversation.id,
            own,
          }),
      });
      send('done', { message: final });
    } catch (error) {
      if (abort.signal.aborted) {
        req.log.info('El usuario ha cortado la respuesta del coach');
      } else {
        req.log.error({ err: error }, 'El coach ha fallado');
        send('error', {
          message:
            error.name === 'LlmError'
              ? `El modelo no ha podido contestar (${error.message})`
              : 'El coach ha fallado, inténtalo de nuevo',
        });
      }
    } finally {
      clearInterval(ping);
      res.end();
    }
  });

  router.post('/messages/:id/apply', validate({ params: messageParams }), async (req, res) => {
    const userId = req.user.id;
    const message = await store.getMessage(userId, req.validated.params.id);
    const display = message?.meta?.display;
    if (display?.type !== 'strength-template') {
      throw HttpError.notFound('No hay ninguna plantilla propuesta en ese mensaje');
    }
    if (display.saved) throw HttpError.conflict('Esa plantilla ya está guardada');

    const app = (await strengthApps?.forUser(userId))?.find((a) => a.id === display.app);
    if (!app) {
      throw HttpError.conflict('La app de fuerza ya no está conectada: vuelve a conectarla');
    }
    let saved;
    try {
      saved = await app.saveTemplate(
        display.session,
        display.templateId ? { templateId: display.templateId } : {},
      );
    } catch (err) {
      if (!(err instanceof StrengthError)) throw err;
      const status = err.code === StrengthErrorCode.NOT_FOUND ? 404 : 409;
      throw new HttpError(status, err.message, { code: err.code });
    }

    const updated = {
      ...display,
      saved: { id: saved.id, created: saved.created, at: new Date().toISOString() },
    };
    // El coach lo sabe en la siguiente pregunta: el resultado de la herramienta lo cuenta
    await store.updateMessage(message.id, {
      content: JSON.stringify({
        saved: true,
        app: display.app,
        templateId: saved.id,
        created: saved.created,
      }),
      meta: { ...message.meta, display: updated },
    });
    req.log.info({ app: display.app, created: saved.created }, 'Plantilla del coach guardada');
    res.json({ display: updated });
  });

  return router;
}

/**
 * Perfil y salud de los últimos 14 días: el coach lo recibe siempre, antes de cada respuesta. Si
 * algo falla, el coach contesta igual (sin ese contexto).
 */
async function coachContext({ queries, userId, getProfile, supplements, engine, timeZone }) {
  const now = Date.now();
  const safe = (fn, fallback) =>
    Promise.resolve()
      .then(fn)
      .catch(() => fallback);
  const [profile, health, state, habitual] = await Promise.all([
    safe(() => getProfile?.() ?? {}, {}),
    safe(
      () =>
        queries.episodes({
          userId,
          from: new Date(now - 14 * 24 * 3600 * 1000),
          to: new Date(now + 3600 * 1000),
          kinds: ['note', 'symptom', 'medication', 'supplement'],
          timeZone,
        }),
      [],
    ),
    safe(() => engine?.state(userId) ?? null, null),
    safe(() => supplements?.list(userId) ?? [], []),
  ]);
  return buildContext({ profile, health, engine: state, supplements: habitual, timeZone });
}
