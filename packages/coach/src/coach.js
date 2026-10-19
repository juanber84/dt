import { z } from 'zod';
import { systemPrompt } from './prompt.js';

/** Lo que se le devuelve al modelo de una herramienta, como mucho (son tokens que paga). */
const MAX_TOOL_OUTPUT = 40_000;

/**
 * Herramientas `{ name, description, inputSchema (shape de zod), handler }` (las de
 * @digitaltwin/mcp) en el formato de tools de la API de OpenAI.
 */
export function toolDefinitions(tools) {
  return tools.map((tool) => {
    // io: 'input' → los campos con .default() salen como opcionales, que es lo que acepta
    const parameters = z.toJSONSchema(z.object(tool.inputSchema), { io: 'input' });
    delete parameters.$schema;
    return {
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters },
    };
  });
}

/**
 * El agente: le da al modelo la conversación y las herramientas, ejecuta las que pida y repite
 * hasta que contesta con texto (o se acaban las vueltas).
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('./llm.js').createChatClient>} deps.llm
 * @param {string} deps.timeZone
 * @param {number} [deps.maxSteps]  Vueltas con herramientas; la última se fuerza a contestar.
 * @param {() => Date} [deps.now]
 * @param {import('pino').Logger} [deps.logger]
 */
export function createCoach({ llm, timeZone, maxSteps = 8, now = () => new Date(), logger }) {
  return {
    /**
     * Contesta al último mensaje de `history`.
     * @param {object} input
     * @param {object[]} input.history  Mensajes en formato OpenAI, sin el de sistema.
     * @param {Array<{ name: string, description: string, inputSchema: object, handler: Function }>} input.tools
     * @param {string} [input.userName]
     * @param {(event: object) => void} [input.onEvent]
     *   { type: 'delta', text } | { type: 'tool', id, name, args } | { type: 'tool_result', id, ok }
     * @param {(message: object) => (void | Promise<void>)} [input.onMessage]
     *   Cada mensaje nuevo (del asistente o resultado de herramienta), para guardarlo.
     * @param {(entry: { model: string, usage: object | null, durationMs: number, error?: string }) => void} [input.onUsage]
     * @param {AbortSignal} [input.signal]
     * @returns {Promise<object>} el mensaje final del asistente
     */
    async run({ history, tools, userName, onEvent, onMessage, onUsage, signal }) {
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      const definitions = toolDefinitions(tools);
      const messages = [
        { role: 'system', content: systemPrompt({ now: now(), timeZone, userName }) },
        ...history,
      ];

      for (let step = 1; ; step++) {
        const last = step >= maxSteps;
        const started = Date.now();
        let result;
        try {
          result = await llm.complete({
            messages,
            tools: definitions,
            toolChoice: last ? 'none' : 'auto',
            onDelta: (text) => onEvent?.({ type: 'delta', text }),
            signal,
          });
        } catch (error) {
          if (error.name !== 'AbortError') {
            onUsage?.({
              model: llm.model,
              usage: null,
              durationMs: Date.now() - started,
              error: error.message,
            });
          }
          throw error;
        }
        onUsage?.({ model: result.model, usage: result.usage, durationMs: Date.now() - started });

        const message = result.message;
        // En la última vuelta no se ejecuta nada más (y sin sus respuestas la conversación no se
        // podría volver a mandar)
        if (last) delete message.tool_calls;
        messages.push(message);
        await onMessage?.(message);
        if (!message.tool_calls?.length) return message;

        for (const call of message.tool_calls) {
          const args = parseArgs(call.function.arguments);
          onEvent?.({ type: 'tool', id: call.id, name: call.function.name, args });
          const { ok, content } = await runTool(byName.get(call.function.name), args, logger);
          onEvent?.({ type: 'tool_result', id: call.id, ok });
          const reply = { role: 'tool', tool_call_id: call.id, content };
          messages.push(reply);
          await onMessage?.(reply);
        }
      }
    },
  };
}

async function runTool(tool, args, logger) {
  if (!tool) return { ok: false, content: 'Error: no existe esa herramienta' };
  if (args === undefined) return { ok: false, content: 'Error: los argumentos no son JSON' };

  const parsed = z.object(tool.inputSchema).safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '-'}: ${i.message}`);
    return { ok: false, content: `Error: argumentos no válidos (${issues.join('; ')})` };
  }
  try {
    const output = JSON.stringify(await tool.handler(parsed.data));
    return {
      ok: true,
      content:
        output.length > MAX_TOOL_OUTPUT
          ? `${output.slice(0, MAX_TOOL_OUTPUT)}… [recortado: pide un rango más corto]`
          : output,
    };
  } catch (error) {
    // ToolError: argumentos fuera de rango, se le cuenta al modelo para que corrija
    if (error.name === 'ToolError') return { ok: false, content: `Error: ${error.message}` };
    logger?.error({ err: error, tool: tool.name }, 'Error en una herramienta del coach');
    return { ok: false, content: 'Error interno al leer los datos' };
  }
}

function parseArgs(raw) {
  if (!raw?.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
