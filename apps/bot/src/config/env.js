import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Token del bot (@BotFather)
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[\w-]+$/, 'formato esperado: 123456:ABC...'),
  // IDs numéricos de usuario de Telegram autorizados, separados por coma. El resto se ignora.
  // Vacío = modo configuración: el bot solo contesta a cada uno con su ID.
  TELEGRAM_ALLOWED_USER_IDS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    )
    .pipe(
      z
        .array(
          z.string().regex(/^\d+$/, 'cada ID es un número (escribe al bot sin IDs y te lo dice)'),
        )
        .transform((ids) => ids.map(Number)),
    ),
  TIMEZONE: z.string().default('Europe/Madrid'),
  // API de Digital Twin: estima las macros (LLM) y guarda las comidas confirmadas
  API_URL: z.url().default('http://localhost:3000'),
  // La clave del bot en DIGITALTWIN_API_KEYS de la API (solo la clave, sin "bot:")
  DIGITALTWIN_API_KEY: z.string().min(16),
  // Firma de los eventos a /webhooks/digitaltwin (la misma que en /api de Infisical). Sin ella las
  // comidas van al endpoint antiguo, que solo las apunta en el log.
  DIGITALTWIN_WEBHOOK_SECRET: z
    .string()
    .min(32, 'al menos 32 caracteres (openssl rand -hex 32)')
    .optional(),
});

/**
 * Valida y normaliza las variables de entorno. Falla rápido si algo es incorrecto.
 * @param {NodeJS.ProcessEnv} [source]
 */
export function loadConfig(source = process.env) {
  const result = schema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuración inválida:\n${details}`);
  }
  return Object.freeze(result.data);
}
