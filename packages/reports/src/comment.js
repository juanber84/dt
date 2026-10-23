import { buildContext, systemPrompt } from '@digitaltwin/coach';
import { commentFacts, longDate } from './daily.js';

const DAY_MS = 24 * 3600 * 1000;

/**
 * Las frases del coach para el informe de la mañana: con su voz y sus reglas (systemPrompt y el
 * mismo contexto de salud que en el chat) y los datos de ayer. Sin herramientas: solo comenta lo
 * que se le pasa, así que no hay cifras que no estén en el informe.
 * @param {object} deps
 * @param {ReturnType<typeof import('@digitaltwin/coach').createChatClient>} deps.chat
 * @param {Awaited<ReturnType<typeof import('./daily.js').gatherDay>>} deps.day
 * @param {string} deps.userId
 * @param {string} [deps.userName]
 * @param {ReturnType<typeof import('@digitaltwin/timeline').createTimelineQueries>} deps.queries
 * @param {{ get: (userId: string) => Promise<object> }} [deps.profiles]
 * @param {{ state: (userId: string) => Promise<object> }} [deps.engine]
 * @param {Date} deps.now
 * @param {string} deps.timeZone
 * @param {(entry: { feature: string, model: string, usage: object | null, durationMs: number, userId: string, error?: string }) => unknown} [deps.onUsage]
 * @returns {Promise<string | null>}  null si el modelo no dice nada
 */
export async function writeDailyComment({
  chat,
  day,
  userId,
  userName,
  queries,
  profiles,
  engine,
  now,
  timeZone,
  onUsage,
}) {
  const safe = (fn, fallback) =>
    Promise.resolve()
      .then(fn)
      .catch(() => fallback);
  const [profile, health, state] = await Promise.all([
    safe(() => profiles?.get(userId) ?? {}, {}),
    safe(
      () =>
        queries.episodes({
          userId,
          from: new Date(now.getTime() - 14 * DAY_MS),
          to: new Date(now.getTime() + 3600 * 1000),
          kinds: ['note', 'symptom', 'medication'],
          timeZone,
        }),
      [],
    ),
    safe(() => engine?.state(userId) ?? null, null),
  ]);
  const context = buildContext({ profile, health, engine: state, timeZone });

  const ask = `Escribe el comentario del informe de esta mañana sobre ayer, ${longDate(day.date)}.
- 3 o 4 frases, en español, tuteando. Sin saludo ni despedida, sin listas ni markdown.
- Lo importante de ayer (comida frente al objetivo, entreno, sueño, salud) y qué hacer hoy.
- No repitas las cifras una a una: ya van en el informe. Como mucho, la que importe.
- Si falta algo (comidas sin apuntar, el sueño aún sin sincronizar), no lo trates como cero:
  dilo o ignóralo.
- Si hay síntomas o medicación, la salud va primero.

Datos de ayer:
${commentFacts(day)}`;

  const started = Date.now();
  try {
    const { message, usage, model } = await chat.complete({
      messages: [
        { role: 'system', content: systemPrompt({ now, timeZone, userName, context }) },
        { role: 'user', content: ask },
      ],
    });
    await onUsage?.({
      feature: 'report.daily',
      model,
      usage,
      durationMs: Date.now() - started,
      userId,
    });
    return message.content?.trim() || null;
  } catch (err) {
    await onUsage?.({
      feature: 'report.daily',
      model: 'unknown',
      usage: null,
      durationMs: Date.now() - started,
      userId,
      error: err.message,
    });
    throw err;
  }
}
