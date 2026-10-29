import { Router } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from '@digitaltwin/mcp';
import { isActive } from '../services/users.js';

/**
 * /api/mcp: servidor MCP (Streamable HTTP, sin estado) sobre el timeline del usuario del token.
 * Se autentica con un token personal (`Authorization: Bearer dt_...`, ver /api/v1/tokens). Cada
 * petición crea su servidor y su transporte; las respuestas van en JSON (sin SSE), que es lo que
 * mejor pasa por nginx y por compression.
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('../services/personal-tokens.js').createDbPersonalTokens>} deps.tokens
 * @param {ReturnType<typeof import('../services/ai-tools.js').createAiTools>} deps.aiTools
 *   Las herramientas del usuario (las mismas que las del coach, escribiendo en vez de proponer).
 * @param {ReturnType<typeof import('../services/users.js').createUserStore>} [deps.users]
 *   Con ellos, el token de un usuario desactivado o caducado deja de valer.
 */
export function createMcpRouter({ tokens, users, aiTools }) {
  const router = Router();

  router.use(async (req, res, next) => {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    let found = match && (await tokens.verify(match[1]));
    if (found && users) {
      const user = await users.findById(found.userId);
      if (!user || !isActive(user)) found = null;
    }
    if (!found) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="digitaltwin"');
      return res.status(401).json(rpcError(-32001, 'Token personal no válido'));
    }
    req.mcpUserId = found.userId;
    req.log = req.log?.child({ user: found.userId, token: found.tokenId }) ?? req.log;
    next();
  });

  router.post('/', async (req, res) => {
    const deps = await aiTools.depsFor(req.mcpUserId, { surface: 'mcp' });
    const server = createMcpServer({ ...deps, logger: req.log });
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
