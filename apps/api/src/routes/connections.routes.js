import { Router } from 'express';
import { z } from 'zod';
import { REGIONS } from '@digitaltwin/xiaomi';
import { validate } from '../middlewares/validate.js';
import { HttpError } from '../utils/http-error.js';
import { PROVIDERS, publicConnection } from '@digitaltwin/connections';
import {
  GOOGLE_PROVIDER,
  OAUTH_STATE_COOKIE,
  GOOGLE_CALLBACK_PATH,
} from '../services/google-connect.js';
import { readCookie } from '../utils/cookies.js';
import { TELEGRAM } from '../services/telegram-link.js';
import { INTERVALS_PROVIDER } from '../services/intervals-connect.js';

const loginBody = z.object({
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200),
  region: z.enum(REGIONS).default('de'),
});
const codeBody = z.object({ code: z.string().trim().min(1).max(20) });
const loginParams = z.object({ loginId: z.uuid() });
const providerParams = z.object({ provider: z.enum(PROVIDERS) });
const syncParams = z.object({ provider: z.enum(['xiaomi', GOOGLE_PROVIDER, INTERVALS_PROVIDER]) });
const apiKeyBody = z.object({ apiKey: z.string().trim().min(8).max(200) });

/**
 * /api/v1/connections: estado de cada proveedor del usuario de la sesión y el login por pasos de
 * Xiaomi. Va detrás de requireUser: siempre hay `req.user`.
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/connections').createMemoryConnectionStore>} deps.store
 * @param {ReturnType<typeof import('../services/xiaomi-login.js').createXiaomiLogin>} deps.xiaomiLogin
 * @param {ReturnType<typeof import('../services/xiaomi-sync.js').createXiaomiSync>} deps.xiaomiSync
 * @param {ReturnType<typeof import('../services/google-connect.js').createGoogleConnect>} [deps.googleConnect]
 *   Sin él (faltan GOOGLE_CLIENT_ID/SECRET), Google sale como no disponible.
 * @param {ReturnType<typeof import('../services/intervals-connect.js').createIntervalsConnect>} [deps.intervalsConnect]
 *   Sin él (sin BD no hay worker que sincronice), intervals.icu sale como no disponible.
 * @param {ReturnType<typeof import('../services/inbox.js').createInbox>} [deps.inbox]
 *   Con BD: las sincronizaciones se encolan para el worker (si no, Xiaomi se sincroniza aquí).
 * @param {(userId: string) => Promise<Record<string, object>>} [deps.backfills]
 *   Progreso de la carga inicial de cada proveedor.
 * @param {ReturnType<typeof import('../services/telegram-link.js').createTelegramLink>} [deps.telegramLink]
 *   Sin él (sin BD o sin DIGITALTWIN_WEBHOOK_SECRET) Telegram no se puede vincular desde aquí.
 * @param {() => string|undefined} [deps.botUsername]
 * @param {boolean} [deps.secureCookies]
 */
export function createConnectionsRouter({
  store,
  xiaomiLogin,
  xiaomiSync,
  googleConnect,
  intervalsConnect,
  inbox,
  backfills,
  telegramLink,
  botUsername = () => undefined,
  secureCookies = false,
}) {
  const router = Router();
  const available = {
    xiaomi: true,
    [GOOGLE_PROVIDER]: Boolean(googleConnect),
    [INTERVALS_PROVIDER]: Boolean(intervalsConnect),
  };

  router.get('/', async (req, res) => {
    const saved = new Map((await store.list(req.user.id)).map((c) => [c.provider, c]));
    const progress = backfills ? await backfills(req.user.id) : {};
    res.json({
      // false: en memoria (sin TOKEN_ENCRYPTION_KEY), se pierden al reiniciar la API
      persistent: store.persistent !== false,
      items: PROVIDERS.map((id) => ({
        id,
        available: available[id] ?? false,
        ...(saved.has(id) ? publicConnection(saved.get(id)) : { status: 'disconnected' }),
        ...(saved.has(id) && progress[id] && { backfill: progress[id] }),
      })),
      // El bot no es un proveedor que conectar: se vincula tu cuenta de Telegram con la tuya
      telegram: {
        available: Boolean(telegramLink),
        ...(saved.has(TELEGRAM)
          ? publicConnection(saved.get(TELEGRAM))
          : { status: 'disconnected' }),
      },
    });
  });

  /**
   * Empieza a vincular Telegram: un código de un solo uso y, si sabemos cómo se llama el bot, el
   * enlace que lo abre con el código ya puesto (t.me/<bot>?start=link-<código>).
   */
  router.post('/telegram/link', (req, res) => {
    if (!telegramLink) {
      throw new HttpError(503, 'Falta la BD o DIGITALTWIN_WEBHOOK_SECRET para vincular Telegram', {
        code: 'NOT_CONFIGURED',
      });
    }
    const { code, expiresAt } = telegramLink.start(req.user.id);
    const bot = botUsername();
    res.json({
      code,
      expiresAt,
      command: `/vincular ${code}`,
      url: bot ? `https://t.me/${bot}?start=link-${code}` : null,
    });
  });

  router.delete('/telegram', async (req, res) => {
    if (!(await store.remove(req.user.id, TELEGRAM))) {
      throw HttpError.notFound('No estaba vinculado', { code: 'NOT_CONNECTED' });
    }
    res.status(204).end();
  });

  router.post('/xiaomi/login', validate({ body: loginBody }), async (req, res) => {
    res.json(await xiaomiLogin.start({ userId: req.user.id, ...req.validated.body }));
  });

  router.post(
    '/xiaomi/login/:loginId/captcha',
    validate({ params: loginParams, body: codeBody }),
    async (req, res) => {
      const { loginId } = req.validated.params;
      res.json(await xiaomiLogin.submitCaptcha(req.user.id, loginId, req.validated.body.code));
    },
  );

  router.post(
    '/xiaomi/login/:loginId/email-code',
    validate({ params: loginParams, body: codeBody }),
    async (req, res) => {
      const { loginId } = req.validated.params;
      res.json(await xiaomiLogin.submitEmailCode(req.user.id, loginId, req.validated.body.code));
    },
  );

  /** Conecta intervals.icu con la clave personal (se comprueba antes de guardarla). */
  router.post(
    `/${INTERVALS_PROVIDER}/connect`,
    validate({ body: apiKeyBody }),
    async (req, res) => {
      if (!intervalsConnect) {
        throw new HttpError(503, 'Sin BD no hay worker que sincronice intervals.icu', {
          code: 'NOT_CONFIGURED',
        });
      }
      res.json(await intervalsConnect.connect(req.user.id, req.validated.body.apiKey));
    },
  );

  /**
   * Trae lo nuevo. Con worker se encola y responde 202 enseguida; sin él (sin BD) Xiaomi se
   * sincroniza aquí mismo: todo el histórico la primera vez, luego solo lo nuevo.
   */
  router.post('/:provider/sync', validate({ params: syncParams }), async (req, res) => {
    const { provider } = req.validated.params;
    const connection = await store.get(req.user.id, provider);
    if (!connection || connection.status === 'disconnected') {
      throw HttpError.conflict('No está conectado', { code: 'NOT_CONNECTED' });
    }
    if (inbox) {
      await inbox.requestSync(req.user.id, provider);
      return res.status(202).json({ queued: true });
    }
    if (provider !== 'xiaomi') {
      throw new HttpError(503, `Sin BD no hay worker que sincronice ${provider}`, {
        code: 'NOT_CONFIGURED',
      });
    }
    res.json(await xiaomiSync.sync(req.user.id));
  });

  /** Empieza el OAuth de Google: devuelve la URL a la que mandar al navegador. */
  router.post(`/${GOOGLE_PROVIDER}/connect`, (req, res) => {
    if (!googleConnect) {
      throw new HttpError(
        503,
        'Falta configurar Google (GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET)',
        {
          code: 'NOT_CONFIGURED',
        },
      );
    }
    const { url, state } = googleConnect.start(req.user.id);
    // Liga el state a este navegador: el callback comprueba que vuelve el mismo. Lax para que
    // viaje en la vuelta desde Google (navegación de otro sitio); solo para la ruta del callback.
    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'lax',
      path: GOOGLE_CALLBACK_PATH,
      maxAge: googleConnect.ttlMs,
    });
    res.json({ url });
  });

  router.delete('/:provider', validate({ params: providerParams }), async (req, res) => {
    const { provider } = req.validated.params;
    if (provider === GOOGLE_PROVIDER)
      await googleConnect?.revoke(await store.get(req.user.id, provider));
    if (!(await store.remove(req.user.id, provider))) {
      throw HttpError.notFound('No estaba conectado', { code: 'NOT_CONNECTED' });
    }
    await inbox?.disconnected(req.user.id, provider);
    res.status(204).end();
  });

  return router;
}

/**
 * GET /api/v1/connections/google-health/callback: la vuelta desde Google. Va fuera de la
 * autenticación (la cookie de sesión no viaja en esta navegación): el usuario sale del state.
 */
export function createGoogleCallbackRouter({ googleConnect, secureCookies = false }) {
  const router = Router();
  router.get('/', async (req, res) => {
    const { state, code, error } = req.query;
    const to = await googleConnect.finish({
      state: typeof state === 'string' ? state : null,
      code: typeof code === 'string' ? code : null,
      error: typeof error === 'string' ? error : null,
      browserState: readCookie(req.headers.cookie, OAUTH_STATE_COOKIE),
    });
    res.clearCookie(OAUTH_STATE_COOKIE, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'lax',
      path: GOOGLE_CALLBACK_PATH,
    });
    res.redirect(303, to);
  });
  return router;
}
