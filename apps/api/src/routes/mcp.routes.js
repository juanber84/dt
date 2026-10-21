import { Router } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from '@digitaltwin/mcp';

/**
 * /api/mcp: servidor MCP (Streamable HTTP, sin estado) sobre el timeline del usuario del token.
 * Se autentica con un token personal (`Authorization: Bearer dt_...`, ver /api/v1/tokens). Cada
 * petición crea su servidor y su transporte; las respuestas van en JSON (sin SSE), que es lo que
 * mejor pasa por nginx y por compression.
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('../services/personal-tokens.js').createDbPersonalTokens>} deps.tokens
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createTimelineQueries>} deps.queries
 * @param {string} deps.timeZone
 */
export function createMcpRouter({ tokens, queries, profiles, timeZone }) {
  const router = Router();

  router.use(async (req, res, next) => {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    const found = match && (await tokens.verify(match[1]));
    if (!found) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="digitaltwin"');
      return res.status(401).json(rpcError(-32001, 'Token personal no válido'));
    }
    req.mcpUserId = found.userId;
    req.log = req.log?.child({ user: found.userId, token: found.tokenId }) ?? req.log;
    next();
  });

  router.post('/', async (req, res) => {
    const server = createMcpServer({
      queries,
      userId: req.mcpUserId,
      timeZone,
      ...(profiles && { getProfile: () => profiles.get(req.mcpUserId) }),
      logger: req.log,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Sin estado: no hay stream de avisos (GET) ni sesiones que cerrar (DELETE)
  router.all('/', (_req, res) => {
    res.status(405).set('Allow', 'POST').json(rpcError(-32000, 'Método no permitido'));
  });

  return router;
}

function rpcError(code, message) {
  return { jsonrpc: '2.0', error: { code, message }, id: null };
}
