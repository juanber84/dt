import { z } from 'zod';
import { DEEPSEEK_BASE_URL, DEEPSEEK_MODEL } from '@digitaltwin/nutrition';
import { parsePrices } from '../services/llm-usage.js';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CORS_ORIGINS: z
      .string()
      .default('*')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    // 300 por minuto y por IP: frena a un bot sin cortar a quien navega por días (cada día que se
    // abre son ~6 peticiones). El login tiene su propio límite, mucho más estricto.
    RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 1000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    BODY_LIMIT: z.string().default('1mb'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    // Valor completo de la cabecera Authorization que manda Google (p. ej. "Bearer xxx").
    // Sin él, el endpoint de webhooks de Google Health no se monta.
    GOOGLE_HEALTH_WEBHOOK_SECRET: z.string().min(16).optional(),
    // Notificaciones push (npx web-push generate-vapid-keys; las mismas en el worker). Sin ellas,
    // la app no ofrece activar avisos
    VAPID_PUBLIC_KEY: z.string().min(1).optional(),
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),
    VAPID_SUBJECT: z.string().min(1).optional(),
    // Firma (HMAC) de los eventos que mandan nuestras apps a /webhooks/digitaltwin (el bot). La
    // misma en /api y /bot de Infisical. Sin ella ese webhook no se monta.
    DIGITALTWIN_WEBHOOK_SECRET: z
      .string()
      .min(32, 'al menos 32 caracteres (openssl rand -hex 32)')
      .optional(),
    // API keys de nuestros clientes (bot, front, scripts...) como "nombre:clave", separadas por coma.
    // Con una de ellas o con sesión (cookie) se accede a todo /api/v1 salvo /health y /auth.
    DIGITALTWIN_API_KEYS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
      )
      .pipe(
        z.array(
          z
            .string()
            .regex(
              /^[\w-]+:.{16,}$/,
              'formato "nombre:clave" con una clave de al menos 16 caracteres',
            )
            .transform((entry) => {
              const index = entry.indexOf(':');
              return { client: entry.slice(0, index), key: entry.slice(index + 1) };
            }),
        ),
      ),
    // Firma de las sesiones (JWT en cookie). Sin ella se genera una al arrancar y las sesiones se
    // pierden en cada reinicio.
    JWT_SECRET: z.string().min(32, 'al menos 32 caracteres (openssl rand -hex 32)').optional(),
    // Cifra las credenciales de los conectores en la BD (AES-256-GCM). Sin ella, las conexiones se
    // guardan solo en memoria. Si se cambia, hay que volver a conectar todo.
    TOKEN_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, '32 bytes en hexadecimal (openssl rand -hex 32)')
      .optional(),
    // Dirección del front tal como la abre el navegador. Con ella se construye la URL de vuelta del
    // OAuth (<PUBLIC_URL>/api/v1/connections/google-health/callback, dada de alta en Google Cloud).
    PUBLIC_URL: z
      .url()
      .default('http://localhost:3081')
      .transform((url) => url.replace(/\/+$/, '')),
    // Cliente OAuth de Google (Google Cloud → Credenciales). Sin ellos, Google sale "no disponible".
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    // API key de Firebase de la app de Motra (se saca de la app; no va en el código). Sin ella,
    // Motra sale "no disponible".
    MOTRA_FIREBASE_API_KEY: z.string().min(1).optional(),
    // Tamaño máximo de un PDF de informe médico (/api/v1/clinical/documents)
    CLINICAL_UPLOAD_LIMIT: z.string().default('15mb'),
    // Tamaño máximo del body en /api/v1/nutrition (las fotos van en base64)
    NUTRITION_BODY_LIMIT: z.string().default('10mb'),
    // LLM compatible con la API de OpenAI para estimar macros (DeepSeek por defecto).
    // Sin LLM_API_KEY, /nutrition/analyze y /nutrition/refine responden 503.
    LLM_API_KEY: z.string().min(1).optional(),
    LLM_BASE_URL: z.url().default(DEEPSEEK_BASE_URL),
    LLM_MODEL: z.string().default(DEEPSEEK_MODEL),
    // LLM del coach (/api/v1/coach). Por defecto, el mismo que el de las macros (LLM_*): sirven
    // para darle al coach un modelo mejor sin tocar el otro. Sin clave ni BD, el coach no se monta.
    COACH_LLM_API_KEY: z.string().min(1).optional(),
    COACH_LLM_BASE_URL: z.url().optional(),
    COACH_LLM_MODEL: z.string().min(1).optional(),
    // Vueltas con herramientas por respuesta; en la última se le obliga a contestar
    COACH_MAX_STEPS: z.coerce.number().int().min(1).max(20).default(8),
    // Precio de cada modelo en USD por millón de tokens, "modelo:entrada/caché/salida" separados por
    // coma. Con él se estima lo gastado (el proveedor solo da el saldo). Revisar si cambian.
    LLM_PRICES: z
      .string()
      .default('deepseek-flash:0.28/0.028/0.42')
      .refine((value) => {
        try {
          parsePrices(value);
          return true;
        } catch {
          return false;
        }
      }, 'formato "modelo:entrada/caché/salida", separados por coma')
      .transform(parsePrices),
    // Por debajo de este saldo (USD) la página de IA y Sistema avisan
    LLM_BALANCE_WARN_USD: z.coerce.number().min(0).default(2),
    TIMEZONE: z.string().default('Europe/Madrid'),
    // PostgreSQL + TimescaleDB. Sin ella la API arranca sin BD (las rutas que la usen no se montan).
    // En Docker la construye el compose con DIGITALTWIN_DB_PASSWORD.
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\/.+/, 'URL de Postgres: postgres://usuario:clave@host:puerto/bd')
      .optional(),
  })
  .transform((config) => ({
    ...config,
    COACH_LLM_API_KEY: config.COACH_LLM_API_KEY ?? config.LLM_API_KEY,
    COACH_LLM_BASE_URL: config.COACH_LLM_BASE_URL ?? config.LLM_BASE_URL,
    COACH_LLM_MODEL: config.COACH_LLM_MODEL ?? config.LLM_MODEL,
  }));

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
