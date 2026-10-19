/** Proveedores que salen en Conexiones (si se pueden conectar lo decide el router). */
export const PROVIDERS = Object.freeze([
  'google-health',
  'xiaomi',
  'strava',
  'intervals-icu',
  'fatsecret',
]);

/**
 * Conexiones de cada usuario con proveedores externos, en memoria (sin BD o sin
 * TOKEN_ENCRYPTION_KEY: se pierden al reiniciar). Misma interfaz que createDbConnectionStore.
 */
export function createMemoryConnectionStore() {
  const items = new Map();
  const id = (userId, provider) => `${userId}:${provider}`;
  return {
    persistent: false,
    async get(userId, provider) {
      return items.get(id(userId, provider)) ?? null;
    },
    async list(userId) {
      return [...items.values()].filter((c) => c.userId === userId);
    },
    /** De quién es la cuenta `externalUserId` del proveedor (los webhooks traen la suya). */
    async findByExternalUser(provider, externalUserId) {
      return (
        [...items.values()].find(
          (c) => c.provider === provider && c.externalUserId === String(externalUserId),
        ) ?? null
      );
    },
    /** Todas las conexiones activas de un proveedor (para las sincronizaciones programadas). */
    async listByProvider(provider) {
      return [...items.values()].filter((c) => c.provider === provider && c.status === 'connected');
    },
    async save(connection) {
      items.set(id(connection.userId, connection.provider), connection);
      return connection;
    },
    async remove(userId, provider) {
      return items.delete(id(userId, provider));
    },
  };
}

/** Lo que ve el front: nunca las credenciales. */
export function publicConnection({ credentials, userId, ...connection }) {
  void credentials;
  void userId;
  return connection;
}
