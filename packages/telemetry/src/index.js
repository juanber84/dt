import { context, propagation, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';

// Solo la API de OpenTelemetry: sin el SDK arrancado (register.js) todo esto no hace nada y no
// cuesta nada, así que se puede usar en los tests y en local.

const tracer = trace.getTracer('digitaltwin');

/** Campo de `data` donde viaja la traza de quien encola (lo lee `withJobSpan` en el worker). */
export const TRACE_FIELD = '_trace';

/**
 * Copia de `data` con la traza activa (traceparent) para que el trabajo siga la misma traza en el
 * worker. Si no hay traza (sin SDK, en un cron...) devuelve `data` tal cual.
 * @template T
 * @param {T} data
 * @returns {T}
 */
export function withTraceContext(data) {
  if (!trace.getSpan(context.active())?.isRecording()) return data;
  const carrier = {};
  propagation.inject(context.active(), carrier);
  if (!carrier.traceparent) return data;
  return { ...(data ?? {}), [TRACE_FIELD]: carrier };
}

/**
 * Ejecuta `fn` dentro de un span (y lo cierra al acabar, con el error si lo hay).
 * @template T
 * @param {string} name
 * @param {object} [options]
 * @param {Record<string, string|number|boolean|undefined>} [options.attributes]
 * @param {import('@opentelemetry/api').SpanKind} [options.kind]
 * @param {import('@opentelemetry/api').Context} [options.parent]
 * @param {(span: import('@opentelemetry/api').Span) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withSpan(name, { attributes, kind = SpanKind.INTERNAL, parent } = {}, fn) {
  const clean = Object.fromEntries(
    Object.entries(attributes ?? {}).filter(([, v]) => v !== undefined && v !== null),
  );
  return tracer.startActiveSpan(
    name,
    { kind, attributes: clean },
    parent ?? context.active(),
    async (span) => {
      try {
        return await fn(span);
      } catch (err) {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message ?? err) });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Span de un trabajo de la cola, hijo de la traza que lo encoló si venía en `data._trace`.
 * @template T
 * @param {string} queue
 * @param {{ id?: string, data?: any, retryCount?: number }} job
 * @param {(span: import('@opentelemetry/api').Span) => Promise<T>} fn
 */
export function withJobSpan(queue, job, fn) {
  const carrier = job.data?.[TRACE_FIELD];
  const parent = carrier ? propagation.extract(context.active(), carrier) : context.active();
  return withSpan(
    `job ${queue}`,
    {
      kind: SpanKind.CONSUMER,
      parent,
      attributes: {
        'messaging.system': 'pg-boss',
        'messaging.destination.name': queue,
        'messaging.message.id': job.id,
        'digitaltwin.job.retry': job.retryCount,
        'digitaltwin.provider': job.data?.provider,
      },
    },
    fn,
  );
}

export { SpanKind };
