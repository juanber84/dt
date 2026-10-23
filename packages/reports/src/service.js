import { composeDaily, gatherDay, longDate, yesterday } from './daily.js';
import { writeDailyComment } from './comment.js';
import { renderReportEmail } from './email.js';

const localClock = (now, timeZone) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);

/**
 * Los informes de cada usuario: el de la mañana (lo de ayer) se genera, se guarda y se manda
 * por correo. El comentario del coach es opcional: si no hay LLM o falla, el informe sale igual
 * con sus cifras.
 * @param {object} deps
 * @param {ReturnType<typeof import('./store.js').createDbReportStore>} deps.store
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createTimelineQueries>} deps.queries
 * @param {ReturnType<typeof import('@digitaltwin/engine').createEngine>} deps.engine
 * @param {ReturnType<typeof import('@digitaltwin/engine').createProfiles>} [deps.profiles]
 * @param {ReturnType<typeof import('@digitaltwin/coach').createChatClient>} [deps.chat]
 * @param {ReturnType<typeof import('@digitaltwin/email').createEmail>} [deps.email]
 * @param {string} deps.appUrl  PUBLIC_URL (enlaces del correo)
 * @param {string} deps.timeZone
 * @param {Function} [deps.onUsage]  Lo gastado en el LLM
 * @param {() => Date} [deps.now]
 * @param {import('pino').Logger} [deps.logger]
 */
export function createReports({
  store,
  queries,
  engine,
  profiles,
  chat,
  email,
  appUrl,
  timeZone,
  onUsage,
  now = () => new Date(),
  logger,
}) {
  /** Genera y guarda el informe de la mañana del día `date` (por defecto, ayer). */
  async function daily({ userId, userName, date }) {
    const at = now();
    const day = await gatherDay({
      userId,
      date: date ?? yesterday(at, timeZone),
      now: at,
      queries,
      engine,
      timeZone,
    });
    let comment = null;
    if (chat) {
      comment = await writeDailyComment({
        chat,
        day,
        userId,
        userName,
        queries,
        profiles,
        engine,
        now: at,
        timeZone,
        onUsage,
      }).catch((err) => {
        logger?.warn({ err: err.message, userId }, 'informe: sin comentario del coach');
        return null;
      });
    }
    return store.save(userId, composeDaily(day, { comment }));
  }

  /** Manda por correo un informe guardado (uno por día: si ya salió, no se repite). */
  async function sendDaily(report, { userId, to, force = false }) {
    if (!email) return { status: 'unconfigured' };
    const mail = renderReportEmail(report, {
      appUrl,
      reportUrl: `${appUrl}/reports/${report.id}`,
      preheader: `Lo de ayer, ${longDate(report.periodFrom)}, y qué hacer hoy.`,
    });
    return email.send(userId, {
      kind: 'daily-report',
      to,
      ...mail,
      // A mano ("mándamelo ya") siempre sale; el automático, una vez por día
      dedupeKey: force ? undefined : report.periodFrom,
    });
  }

  return {
    store,
    daily,
    sendDaily,

    /**
     * El cron: a cada usuario con el informe activado, una vez pasada su hora, el de ayer. Si ya
     * está guardado, no se vuelve a hacer (ni a mandar).
     */
    async runDaily() {
      const at = now();
      const clock = localClock(at, timeZone);
      const date = yesterday(at, timeZone);
      const done = [];
      for (const r of await store.recipients()) {
        if (!r.dailyEnabled || clock < r.dailyTime) continue;
        if (await store.dailyExists(r.userId, date)) continue;
        try {
          const report = await daily({ userId: r.userId, userName: r.name, date });
          const sent = await sendDaily(report, { userId: r.userId, to: r.email });
          logger?.info({ userId: r.userId, date, email: sent.status }, 'informe de la mañana');
          done.push({ userId: r.userId, reportId: report.id, email: sent.status });
        } catch (err) {
          logger?.error({ err, userId: r.userId, date }, 'informe de la mañana: falló');
          done.push({ userId: r.userId, error: err.message });
        }
      }
      return { date, done };
    },
  };
}
