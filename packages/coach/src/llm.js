/** Error del proveedor del LLM (red, HTTP, respuesta rota). `status` si vino de una respuesta HTTP. */
export class LlmError extends Error {
  name = 'LlmError';

  constructor(message, { status, cause } = {}) {
    super(message, { cause });
    this.status = status;
  }
}

/**
 * Cliente de chat con herramientas para cualquier API compatible con la de OpenAI (DeepSeek por
 * defecto), en streaming: el texto va saliendo por `onDelta` mientras el modelo escribe.
 *
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} options.baseUrl  p. ej. https://api.deepseek.com
 * @param {string} options.model
 * @param {object} [options.extraBody]  Campos extra (el `thinking` de DeepSeek...).
 * @param {number} [options.maxTokens]
 * @param {number} [options.temperature]
 * @param {number} [options.timeoutMs]  De cada llamada, contando el streaming entero.
 * @param {typeof fetch} [options.fetch]
 */
export function createChatClient({
  apiKey,
  baseUrl,
  model,
  extraBody = {},
  maxTokens = 2000,
  temperature = 0.4,
  timeoutMs = 120_000,
  fetch = globalThis.fetch,
}) {
  if (!apiKey) throw new Error('createChatClient: falta apiKey');
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  return {
    model,

    /**
     * Una vuelta del modelo.
     * @param {object} input
     * @param {object[]} input.messages  Formato OpenAI (system, user, assistant, tool).
     * @param {object[]} [input.tools]   Definiciones `{ type: 'function', function }`.
     * @param {'auto' | 'none'} [input.toolChoice]
     * @param {(text: string) => void} [input.onDelta]
     * @param {AbortSignal} [input.signal]
     * @returns {Promise<{ message: object, usage: object | null, model: string, finishReason: string | null }>}
     */
    async complete({ messages, tools, toolChoice = 'auto', onDelta, signal }) {
      const signals = [AbortSignal.timeout(timeoutMs), signal].filter(Boolean);
      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages,
            ...(tools?.length && { tools, tool_choice: toolChoice }),
            stream: true,
            stream_options: { include_usage: true },
            max_tokens: maxTokens,
            temperature,
            ...extraBody,
          }),
          signal: AbortSignal.any(signals),
        });
      } catch (error) {
        throw networkError(error);
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message = payload?.error?.message ?? response.statusText;
        throw new LlmError(`${response.status}: ${message}`, { status: response.status });
      }

      const state = { content: '', calls: [], usage: null, model, finishReason: null };
      try {
        for await (const chunk of sseData(response.body)) {
          if (chunk === '[DONE]') break;
          let data;
          try {
            data = JSON.parse(chunk);
          } catch {
            throw new LlmError('El modelo ha devuelto un trozo que no es JSON');
          }
          apply(state, data, onDelta);
        }
      } catch (error) {
        throw error instanceof LlmError ? error : networkError(error);
      }

      const message = { role: 'assistant', content: state.content };
      const calls = state.calls.filter(Boolean);
      if (calls.length) message.tool_calls = calls;
      return { message, usage: state.usage, model: state.model, finishReason: state.finishReason };
    },
  };
}

/** Suma un trozo del stream: texto, llamadas a herramientas (llegan troceadas por índice), uso. */
function apply(state, data, onDelta) {
  if (data.model) state.model = data.model;
  if (data.usage) state.usage = data.usage;
  const choice = data.choices?.[0];
  if (!choice) return;
  if (choice.finish_reason) state.finishReason = choice.finish_reason;
  const delta = choice.delta ?? {};
  if (delta.content) {
    state.content += delta.content;
    onDelta?.(delta.content);
  }
  for (const part of delta.tool_calls ?? []) {
    const call = (state.calls[part.index ?? 0] ??= {
      id: '',
      type: 'function',
      function: { name: '', arguments: '' },
    });
    if (part.id) call.id = part.id;
    if (part.function?.name) call.function.name += part.function.name;
    if (part.function?.arguments) call.function.arguments += part.function.arguments;
  }
}

/** Los `data:` de un stream SSE, uno por evento. */
async function* sseData(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  const last = buffer.trim();
  if (last.startsWith('data:')) yield last.slice(5).trim();
}

function networkError(error) {
  if (error.name === 'TimeoutError') return new LlmError('El modelo ha tardado demasiado');
  if (error.name === 'AbortError') return error;
  return new LlmError(`Error de red: ${error.message}`, { cause: error });
}
