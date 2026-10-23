import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createTools, ToolError } from './tools.js';

const INSTRUCTIONS = `Datos de salud de una persona (su "gemelo digital"): báscula, comida, entrenos, sueño,
actividad y constantes, de varias fuentes (Google Health, Xiaomi, intervals.icu, Motra, el bot de comidas).
Empieza por list_metrics para ver qué hay. Para la fuerza (ejercicios, series, reps y pesos) usa
get_strength_sets. Las fechas son días locales (YYYY-MM-DD) en su zona horaria.
Los datos del día en curso pueden estar incompletos. No saques tendencias de un solo valor.`;

/**
 * Servidor MCP de un usuario, sin transporte: quien lo monta (HTTP en la API, stdio...) decide
 * cómo llega. Uno por petición en modo sin estado.
 * @param {Parameters<typeof createTools>[0] & { logger?: import('pino').Logger }} deps
 */
export function createMcpServer({ logger, ...deps }) {
  const server = new McpServer(
    { name: 'twinme', version: '0.1.0' },
    { instructions: INSTRUCTIONS },
  );

  for (const tool of createTools(deps)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (args) => {
        try {
          const result = await tool.handler(args ?? {});
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (err) {
          if (!(err instanceof ToolError)) {
            logger?.error({ err, tool: tool.name }, 'Error en una herramienta MCP');
          }
          const message =
            err instanceof ToolError ? err.message : 'Error interno al leer los datos';
          return { isError: true, content: [{ type: 'text', text: message }] };
        }
      },
    );
  }

  return server;
}
