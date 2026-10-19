import { Router } from 'express';
import { z } from 'zod';
import { createChartTool } from '@digitaltwin/coach';
import { createTools } from '@digitaltwin/mcp';
import { validate } from '../middlewares/validate.js';
import { HttpError } from '../utils/http-error.js';
import { titleFrom, toModelHistory } from '../services/coach-store.js';

const idParams = z.object({ id: z.uuid() });
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
 *     message (cada mensaje del asistente guardado) ·
 *     done { message } | error { message }
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/coach').createCoach>} deps.coach
 * @param {ReturnType<typeof import('../services/coach-store.js').createMemoryCoachStore>} deps.store
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createTimelineQueries>} deps.queries
 * @param {string} deps.timeZone
 * @param {ReturnType<typeof import('../services/llm-usage.js').createLlmUsage>} [deps.usage]
 */
export function createCoachRouter({ coach, store, queries, timeZone, usage }) {
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

    // Las de lectura (las mismas del MCP) y show_chart, que solo tiene sentido en la app
    const tools = createTools({ queries, userId, timeZone });
    const getSeries = tools.find((tool) => tool.name === 'get_series').handler;
    tools.push(createChartTool({ getSeries }));

    try {
      const final = await coach.run({
        history: toModelHistory([...conversation.messages, question]),
        tools,
        userName: req.user.name ?? undefined,
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
        },
        onUsage: (entry) =>
          usage?.record({ ...entry, feature: 'coach', userId, conversationId: conversation.id }),
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

  return router;
}
