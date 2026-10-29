/**
 * Las apps de fuerza de cada usuario (adaptadores de @digitaltwin/strength) para el MCP. Cada
 * proveedor dice si el usuario la tiene conectada; una nueva (Hevy...) es otra entrada en
 * `providers`. Si una falla al prepararse, se sigue con las demás.
 * @param {object} deps
 * @param {{ forUser: (userId: string) => Promise<import('@digitaltwin/strength').StrengthApp|null> }[]} deps.providers
 * @param {import('pino').Logger} [deps.logger]
 */
export function createStrengthApps({ providers, logger }) {
  return {
    /** @returns {Promise<import('@digitaltwin/strength').StrengthApp[]>} */
    async forUser(userId) {
      const apps = await Promise.all(
        providers.map((provider) =>
          provider.forUser(userId).catch((err) => {
            logger?.error({ err }, 'No se pudo preparar una app de fuerza');
            return null;
          }),
        ),
      );
      return apps.filter(Boolean);
    },
  };
}
