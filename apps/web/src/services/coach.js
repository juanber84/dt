import { apiFetch, apiStream } from '../api.js';

/** Conversaciones con el coach (la más reciente primero). 404 = el coach no está montado. */
export const listConversations = () => apiFetch('/api/v1/coach/conversations').then((r) => r.items);

export const getConversation = (id) => apiFetch(`/api/v1/coach/conversations/${id}`);

export const deleteConversation = (id) =>
  apiFetch(`/api/v1/coach/conversations/${id}`, { method: 'DELETE' });

/**
 * Pregunta al coach. `onEvent(event, data)` recibe el stream: conversation, user, tool,
 * tool_result, delta, message, done, error.
 * @param {{ conversationId?: string, text: string, context?: { date?: string } }} body
 */
export const sendMessage = (body, onEvent, options) =>
  apiStream('/api/v1/coach/messages', body, onEvent, options);

/** Qué hace cada herramienta, dicho para personas (las chips de "ha consultado…"). */
const TOOL_LABELS = {
  list_metrics: () => 'Qué datos hay',
  get_series: (a) => `Series ${a.from && a.to ? `${a.from} → ${a.to}` : ''}`.trim(),
  get_episodes: (a) => `Comidas, entrenos y sueño ${a.from ?? ''}`.trim(),
  get_observations: (a) => `Datos crudos ${a.from ?? ''}`.trim(),
  get_day_summary: (a) => `Resumen del día ${a.date ?? 'de hoy'}`,
};

export function toolLabel(name, args = {}) {
  return TOOL_LABELS[name]?.(args ?? {}) ?? name;
}

/**
 * Mensajes guardados → lo que se pinta: cada pregunta y una respuesta por pregunta, con el texto
 * de todas las vueltas del asistente y las herramientas que usó (los resultados no se enseñan).
 */
export function toChat(messages) {
  const out = [];
  let answer = null;
  for (const m of messages) {
    if (m.role === 'user') {
      answer = null;
      out.push({ id: m.id, role: 'user', content: m.content, context: m.meta?.context });
    } else if (m.role === 'assistant') {
      if (!answer) {
        answer = { id: m.id, role: 'assistant', content: '', tools: [] };
        out.push(answer);
      }
      answer.id = m.id;
      for (const call of m.toolCalls ?? []) {
        answer.tools.push({
          id: call.id,
          name: call.function.name,
          args: parseArgs(call),
          ok: true,
        });
      }
      if (m.content) answer.content += (answer.content ? '\n\n' : '') + m.content;
    } else if (m.role === 'tool' && answer && m.content.startsWith('Error')) {
      const tool = answer.tools.find((t) => t.id === m.toolCallId);
      if (tool) tool.ok = false;
    }
  }
  return out;
}

function parseArgs(call) {
  try {
    return JSON.parse(call.function.arguments || '{}');
  } catch {
    return {};
  }
}
