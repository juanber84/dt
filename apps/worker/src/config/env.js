import { z } from 'zod';
import { DEEPSEEK_BASE_URL, DEEPSEEK_MODEL } from '@digitaltwin/clinical';
import { parsePrices } from '@digitaltwin/llm-usage';

const cron = z.string().regex(/^(\S+\s+){4}\S+$/, 'expresión cron de 5 campos');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\/.+/, 'URL de Postgres: postgres://usuario:clave@host:puerto/bd'),
  // La misma que la API: sin ella no se pueden leer las credenciales de las conexiones
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, '32 bytes en hexadecimal (openssl rand -hex 32)'),
  // Cliente OAuth de Google (el de la API). Sin ellos no se sincroniza Google.
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  TIMEZONE: z.string().default('Europe/Madrid'),
  // Suscriptor de webhooks de Google: lo crea o corrige el worker al arrancar y una vez al día.
  // Hacen falta los tres; sin ellos (en local) no se toca. PUBLIC_URL y el secreto son los de la API.
  PUBLIC_URL: z
    .url()
    .optional()
    .transform((url) => url?.replace(/\/+$/, '')),
  GOOGLE_HEALTH_WEBHOOK_SECRET: z.string().min(16).optional(),
  // Número (no ID) del proyecto de Google Cloud: con el ID la API responde PERMISSION_DENIED. Por
  // defecto, el del cliente OAuth (su ID empieza por él), que es donde tiene que estar el suscriptor
  GOOGLE_CLOUD_PROJECT_NUMBER: z.string().regex(/^\d+$/, 'solo dígitos').optional(),
  // Notificaciones push (las mismas claves que la API: npx web-push generate-vapid-keys). Sin
  // ellas no se manda ningún aviso
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  // A quién avisa el servicio de push si hay problemas: una URL nuestra o mailto: (por defecto, PUBLIC_URL)
  VAPID_SUBJECT: z.string().min(1).optional(),
  // Cada cuánto se mira a quién le toca ya el informe de la mañana (cada uno tiene su hora)
  DAILY_REPORTS_CRON: cron.default('*/10 * * * *'),
  // Correos (la misma clave de Resend que la API, solo de envío). Sin ella no se manda ninguno
  RESEND_API_KEY: z.string().startsWith('re_').optional(),
  EMAIL_FROM: z.string().min(3).default('TwinMe <informe@twinme.app>'),
  // Cuándo se mira si alguien no ha apuntado ninguna comida en el día (hora de TIMEZONE)
  PUSH_MEALS_CRON: cron.default('0 16 * * *'),
  // Aviso de que el permiso de Google caduca en menos de 2 días (a media mañana)
  PUSH_EXPIRING_CRON: cron.default('0 11 * * *'),
  // Copia de seguridad diaria a Google Drive, cifrada con age. Sin las dos, no se hace.
  // BACKUP_DRIVE_TOKEN: el JSON de `rclone authorize drive` (permiso drive.file)
  BACKUP_DRIVE_TOKEN: z.string().min(1).optional(),
  // Clave PÚBLICA de age (age1...): la privada, para restaurar, solo la tiene el dueño
  BACKUP_AGE_RECIPIENT: z
    .string()
    .regex(/^age1[0-9a-z]{58}$/, 'clave pública de age (age1…)')
    .optional(),
  BACKUP_CRON: cron.default('0 4 * * *'),
  BACKUP_DRIVE_FOLDER: z.string().min(1).default('digitaltwin-backups'),
  BACKUP_KEEP_DAYS: z.coerce.number().int().positive().default(30),
  // JSON de la cuenta de servicio con rol "Google Health API Editor" (el fichero entero)
  GOOGLE_HEALTH_SERVICE_ACCOUNT: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) return undefined;
      try {
        const json = JSON.parse(value);
        if (json.client_email && json.private_key && json.project_id) return json;
      } catch {
        // cae al error de abajo
      }
      ctx.addIssue({ code: 'custom', message: 'JSON de cuenta de servicio de Google' });
      return z.NEVER;
    }),
  // Cuándo se sincroniza solo (hora de TIMEZONE). Google avisa por webhook; el cron de cada hora
  // recoge lo que se haya podido escapar (y es lo único que llega en local, sin webhook).
  XIAOMI_SYNC_CRON: cron.default('*/30 * * * *'),
  GOOGLE_SYNC_CRON: cron.default('0 * * * *'),
  INTERVALS_SYNC_CRON: cron.default('20 * * * *'),
  MOTRA_SYNC_CRON: cron.default('40 * * * *'),
  // Cuánto histórico se trae la primera vez y en trozos de cuántos días
  GOOGLE_BACKFILL_DAYS: z.coerce.number().int().positive().default(730),
  GOOGLE_BACKFILL_CHUNK_DAYS: z.coerce.number().int().positive().max(90).default(30),
  // Peticiones por minuto a cada API (compartido entre todos los workers)
  GOOGLE_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(120),
  XIAOMI_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(10),
  INTERVALS_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(30),
  // Motra pide un detalle por entreno (más llamadas), pero son pocos entrenos: un ritmo tranquilo
  MOTRA_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(60),
  // Cuánto histórico de intervals.icu se trae la primera vez
  INTERVALS_BACKFILL_DAYS: z.coerce.number().int().positive().default(730),
  // Cuánto histórico de Motra se trae la primera vez (los entrenos de fuerza vienen de lejos)
  MOTRA_BACKFILL_DAYS: z.coerce.number().int().positive().default(1825),
  // API key de Firebase de la app de Motra (se saca de la app; no va en el código). Sin ella,
  // Motra no se sincroniza.
  MOTRA_FIREBASE_API_KEY: z.string().min(1).optional(),
  // LLM del coach (el mismo que la API: el comentario del informe de la mañana). Sin ellos, el
  // de LLM_*
  COACH_LLM_API_KEY: z.string().min(1).optional(),
  COACH_LLM_BASE_URL: z.url().optional(),
  COACH_LLM_MODEL: z.string().min(1).optional(),
  // LLM para leer los informes médicos (el mismo LLM_* que la API). Sin clave, los PDF que se
  // suban quedan en error explicándolo.
  LLM_API_KEY: z.string().min(1).optional(),
  LLM_BASE_URL: z.url().default(DEEPSEEK_BASE_URL),
  LLM_MODEL: z.string().default(DEEPSEEK_MODEL),
  // Precios para apuntar el gasto en llm_usage (mismo formato que en la API)
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
