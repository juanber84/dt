/**
 * Quién paga cada llamada al LLM: la clave de la app (con un límite de gasto al día por usuario) o
 * la del propio usuario (de uno de los proveedores de la lista, sin límite). Lo usan la API (coach,
 * macros, subir informes) y el worker (informes médicos, informe de la mañana).
 */

/**
 * Proveedores que se pueden conectar: todos con la API de OpenAI (/chat/completions). Solo de esta
 * lista: la URL no la escribe el usuario (si no, el servidor llamaría a donde le dijeran).
 */
export const AI_PROVIDERS = Object.freeze({
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    modelHint: 'deepseek-flash',
    keysUrl: 'https://platform.deepseek.com/api_keys',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    modelHint: 'gpt-4.1-mini',
    keysUrl: 'https://platform.openai.com/api-keys',
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelHint: 'deepseek/deepseek-chat',
    keysUrl: 'https://openrouter.ai/keys',
  },
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelHint: 'llama-3.3-70b-versatile',
    keysUrl: 'https://console.groq.com/keys',
  },
  mistral: {
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    modelHint: 'mistral-small-latest',
    keysUrl: 'https://console.mistral.ai/api-keys',
  },
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelHint: 'gemini-2.5-flash',
    keysUrl: 'https://aistudio.google.com/apikey',
  },
});

/** El `thinking` es propio de DeepSeek (desactivado: más rápido y barato); otros lo rechazarían. */
export const extraBodyFor = (baseUrl) =>
  /(^|\.)deepseek\.com$/.test(new URL(baseUrl).hostname) ? { thinking: { type: 'disabled' } } : {};

/** Se ha gastado lo de hoy con la clave de la app. */
export class AiLimitError extends Error {
  name = 'AiLimitError';
  code = 'AI_LIMIT';

  constructor({ spentUsd, limitUsd }) {
    super(
      'Has llegado al límite de IA de hoy. Vuelve mañana o conecta tu propia clave en Cuenta → IA.',
    );
    this.spentUsd = spentUsd;
    this.limitUsd = limitUsd;
  }
}

/** Lo que se ve de una clave: los 4 últimos caracteres. */
export const keyHint = (apiKey) => `…${apiKey.slice(-4)}`;

/** Contexto del cifrado: la clave de un usuario no se descifra en la fila de otro. */
const sealContext = (userId) => `llm-provider:${userId}`;

/**
 * @param {object} deps
 * @param {ReturnType<typeof createDbAiStore>} deps.store
 * @param {{ seal: Function, open: Function }} [deps.box]  Cifra las claves (TOKEN_ENCRYPTION_KEY).
 *   Sin él no se pueden guardar claves propias.
 * @param {number} deps.defaultLimitUsd  Límite al día de quien no tiene uno propio.
 * @param {string} deps.timeZone  El día empieza a medianoche en esta zona.
 * @param {() => Date} [deps.now]
 */
export function createAiAccess({ store, box, defaultLimitUsd, timeZone, now = () => new Date() }) {
  const limitOf = (row) => (row.role === 'admin' ? null : (row.limitUsd ?? defaultLimitUsd));

  return {
    canStoreKeys: Boolean(box),

    /**
     * Con qué LLM va la siguiente llamada del usuario.
     * - Con clave propia: `{ own: true, provider: { apiKey, baseUrl, model, extraBody } }`.
     * - Si no: `{ own: false }` (la de la app). Lanza AiLimitError si ya ha gastado lo de hoy.
     * @param {string} userId
     */
    async resolve(userId) {
      const row = await store.get(userId);
      if (!row) return { own: false };
      if (row.provider && box) {
        const { apiKey } = box.open(row.provider.sealedKey, sealContext(userId));
        const { baseUrl } = AI_PROVIDERS[row.provider.id];
        return {
          own: true,
          provider: {
            apiKey,
            baseUrl,
            model: row.provider.model,
            extraBody: extraBodyFor(baseUrl),
          },
        };
      }
      const limitUsd = limitOf(row);
      if (limitUsd !== null) {
        const spentUsd = await store.spentSince(userId, startOfDay(now(), timeZone));
        if (spentUsd >= limitUsd) throw new AiLimitError({ spentUsd, limitUsd });
      }
      return { own: false };
    },

    /** Lo de Cuenta → IA: el límite, lo gastado hoy y su proveedor (sin la clave). */
    async status(userId) {
      const row = await store.get(userId);
      const limitUsd = row ? limitOf(row) : defaultLimitUsd;
      return {
        limitUsd,
        spentTodayUsd: await store.spentSince(userId, startOfDay(now(), timeZone)),
        own: row?.provider
          ? {
              provider: row.provider.id,
              model: row.provider.model,
              keyHint: row.provider.keyHint,
              updatedAt: row.provider.updatedAt,
            }
          : null,
        canStoreKeys: Boolean(box),
      };
    },

    /** Guarda (cifrada) su clave. `apiKey` vacío: se queda la de antes (cambiar solo el modelo). */
    async saveProvider(userId, { provider, model, apiKey }) {
      if (!box) throw new Error('Sin TOKEN_ENCRYPTION_KEY no se guardan claves');
      if (!AI_PROVIDERS[provider]) throw new Error(`Proveedor desconocido: ${provider}`);
      await store.saveProvider(userId, {
        id: provider,
        model,
        sealedKey: box.seal({ apiKey }, sealContext(userId)),
        keyHint: keyHint(apiKey),
      });
    },

    /** La clave guardada, para probarla otra vez al cambiar de modelo. */
    async storedKey(userId) {
      const row = await store.get(userId);
      if (!row?.provider || !box) return null;
      return box.open(row.provider.sealedKey, sealContext(userId)).apiKey;
    },

    removeProvider: (userId) => store.removeProvider(userId),
  };
}

/**
 * Prueba una clave antes de guardarla, con lo mismo que piden la app: modo JSON (macros, informes
 * médicos) y herramientas (coach). Devuelve null si va bien; si no, el motivo.
 * @param {{ apiKey: string, baseUrl: string, model: string }} provider
 * @param {{ fetch?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<string | null>}
 */
export async function testProvider(
  { apiKey, baseUrl, model },
  { fetch = globalThis.fetch, timeoutMs = 30_000 } = {},
) {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const base = { model, max_tokens: 60, temperature: 0.2, ...extraBodyFor(baseUrl) };
  const checks = [
    {
      what: 'modo JSON',
      body: {
        ...base,
        messages: [{ role: 'user', content: 'Responde solo con este JSON: {"ok": true}' }],
        response_format: { type: 'json_object' },
      },
    },
    {
      what: 'herramientas',
      body: {
        ...base,
        messages: [{ role: 'user', content: 'Di "ok".' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'ping',
              description: 'No hace nada',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
        tool_choice: 'auto',
      },
    },
  ];
  for (const { what, body } of checks) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return error.name === 'TimeoutError'
        ? 'El proveedor ha tardado demasiado en contestar'
        : `No se ha podido llamar al proveedor (${error.message})`;
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const message =
        payload?.error?.message ?? payload?.[0]?.error?.message ?? response.statusText;
      if (response.status === 401 || response.status === 403) return `Clave no válida (${message})`;
      return `Falla con ${what}: ${response.status} ${message}`.trim();
    }
  }
  return null;
}

/** Filas en la BD: users (rol, límite), user_llm_providers (su clave) y llm_usage (lo gastado). */
export function createDbAiStore({ db }) {
  return {
    async get(userId) {
      const [row] = await db`
        select u.role, u.ai_daily_limit_usd, p.provider, p.model, p.api_key, p.key_hint,
          p.updated_at
        from users u left join user_llm_providers p on p.user_id = u.id
        where u.id = ${userId}
      `;
      if (!row) return null;
      return {
        role: row.role,
        limitUsd: row.ai_daily_limit_usd === null ? null : Number(row.ai_daily_limit_usd),
        provider:
          row.provider && AI_PROVIDERS[row.provider]
            ? {
                id: row.provider,
                model: row.model,
                sealedKey: row.api_key,
                keyHint: row.key_hint,
                updatedAt: row.updated_at.toISOString(),
              }
            : null,
      };
    },

    /** Lo gastado con la clave de la app (lo de su clave no cuenta). */
    async spentSince(userId, from) {
      const [row] = await db`
        select coalesce(sum(cost_usd), 0) as total from llm_usage
        where user_id = ${userId} and not own_key and at >= ${from}
      `;
      return Number(row.total);
    },

    async saveProvider(userId, { id, model, sealedKey, keyHint }) {
      await db`
        insert into user_llm_providers (user_id, provider, model, api_key, key_hint)
        values (${userId}, ${id}, ${model}, ${sealedKey}, ${keyHint})
        on conflict (user_id) do update set
          provider = excluded.provider, model = excluded.model, api_key = excluded.api_key,
          key_hint = excluded.key_hint, updated_at = now()
      `;
    },

    async removeProvider(userId) {
      const rows = await db`delete from user_llm_providers where user_id = ${userId} returning 1`;
      return rows.length > 0;
    },
  };
}

/**
 * Lo mismo en memoria (tests y arranque sin BD).
 * @param {object} deps
 * @param {{ findById: Function }} deps.users  Rol y `aiDailyLimitUsd` de cada usuario.
 * @param {{ since: (from: Date) => Promise<object[]> }} deps.usage  Las filas de llm_usage.
 */
export function createMemoryAiStore({ users, usage }) {
  const providers = new Map();
  return {
    async get(userId) {
      const user = await users.findById(userId);
      if (!user) return null;
      return {
        role: user.role,
        limitUsd: user.aiDailyLimitUsd ?? null,
        provider: providers.get(userId) ?? null,
      };
    },
    async spentSince(userId, from) {
      const rows = await usage.since(from);
      return rows
        .filter((r) => r.userId === userId && !r.ownKey)
        .reduce((sum, r) => sum + r.costUsd, 0);
    },
    async saveProvider(userId, provider) {
      providers.set(userId, { ...provider, updatedAt: new Date().toISOString() });
    },
    async removeProvider(userId) {
      return providers.delete(userId);
    },
  };
}

/** Medianoche de hoy en `timeZone`. */
export function startOfDay(now, timeZone) {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone })
    .format(now)
    .split('-')
    .map(Number);
  const guess = Date.UTC(year, month - 1, day);
  let ms = guess - offsetMs(guess, timeZone);
  // Si entre medias hay cambio de hora, el desfase bueno es el del resultado
  ms = guess - offsetMs(ms, timeZone);
  return new Date(ms);
}

/** Desfase (ms) de `timeZone` respecto a UTC en el instante `ms`. */
function offsetMs(ms, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, Number(p.value)]),
  );
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - Math.floor(ms / 1000) * 1000;
}
