import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createTools, ToolError } from './tools.js';

const INSTRUCTIONS = `Datos de salud de una persona (su "gemelo digital"): báscula, comida, entrenos, sueño,
actividad y constantes, de varias fuentes (Google Health, intervals.icu, una báscula, una app de fuerza, el bot de comidas).
Empieza por list_metrics para ver qué hay. Para la fuerza (ejercicios, series, reps y pesos) usa
get_strength_sets. Las fechas son días locales (YYYY-MM-DD) en su zona horaria.
Los datos del día en curso pueden estar incompletos. No saques tendencias de un solo valor.
Si tiene conectada alguna app de fuerza, también puedes preparar sesiones como plantillas
(save_strength_template): si tiene varias, pregúntale en cuál; busca los ejercicios en el catálogo
de esa app (search_exercises, sin los proOnly), enséñale la sesión y guárdala solo cuando la
confirme. Sus plantillas no se tocan; solo se reescriben o borran las de TwinMe.`;

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
        // Por defecto de solo lectura; las que escriben (plantillas de fuerza) traen las suyas
        annotations: tool.annotations ?? { readOnlyHint: true, openWorldHint: false },
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
