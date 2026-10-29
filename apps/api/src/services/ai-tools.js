/**
 * Lo que necesitan las herramientas de IA de un usuario (createTools de @digitaltwin/mcp), en un
 * solo sitio para el MCP y el coach: así una herramienta nueva llega a los dos a la vez. Solo
 * cambia cómo se escribe en sus apps de fuerza: el MCP escribe (el permiso lo pide su cliente) y
 * el coach propone en una tarjeta que el usuario guarda con un botón.
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createTimelineQueries>} deps.queries
 * @param {string} deps.timeZone
 * @param {{ get: (userId: string) => Promise<object> }} [deps.profiles]
 * @param {{ state: (userId: string) => Promise<object> }} [deps.engine]
 * @param {ReturnType<typeof import('./strength-apps.js').createStrengthApps>} [deps.strengthApps]
 */
export function createAiTools({ queries, timeZone, profiles, engine, strengthApps }) {
  return {
    /**
     * @param {string} userId
     * @param {{ surface: 'mcp' | 'coach' }} options
     */
    async depsFor(userId, { surface }) {
      const apps = (await strengthApps?.forUser(userId)) ?? [];
      return {
        queries,
        userId,
        timeZone,
        ...(profiles && { getProfile: () => profiles.get(userId) }),
        ...(engine && { getEngine: () => engine.state(userId) }),
        ...(apps.length && {
          strength: { apps, writes: surface === 'coach' ? 'propose' : 'direct' },
        }),
      };
    },
  };
}
