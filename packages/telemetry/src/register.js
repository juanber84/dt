// Arranque de OpenTelemetry. Tiene que ir antes que la app, para que las librerías que mide (http,
// express, pg, pino, fetch) se carguen ya parcheadas:
//   node --import @digitaltwin/telemetry/register .
// (en Docker va en NODE_OPTIONS, ver docker-compose.prod.yml).
//
// Sin OTEL_EXPORTER_OTLP_ENDPOINT no hace nada: en local y en los tests no se arranca.
// En producción manda las trazas a digitaltwin-alloy (:4318), que las pasa a Grafana Cloud.
// El nombre del servicio sale de OTEL_SERVICE_NAME (digitaltwin-api, -worker, -bot).
//
// Qué se mide:
//   - Peticiones que entran a la API (menos /health y /metrics) y su paso por express.
//   - Llamadas que salen con fetch (Google, DeepSeek, intervals.icu, Telegram, la API desde el bot)
//     y con http, solo dentro de una traza: el sondeo de Telegram o pg-boss no crean trazas solas.
//   - Consultas de pg (las de pg-boss), también solo dentro de una traza. postgres.js, el cliente
//     del resto de la app, no tiene instrumentación: sus consultas no salen.
//   - pino añade trace_id y span_id a cada log escrito dentro de una traza.
import { register } from 'node:module';

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT && process.env.OTEL_SDK_DISABLED !== 'true') {
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);

  const [
    { NodeSDK },
    { OTLPTraceExporter },
    { BatchSpanProcessor },
    { HttpInstrumentation },
    { ExpressInstrumentation },
    { PgInstrumentation },
    { PinoInstrumentation },
    { UndiciInstrumentation },
  ] = await Promise.all([
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/exporter-trace-otlp-proto'),
    import('@opentelemetry/sdk-trace-base'),
    import('@opentelemetry/instrumentation-http'),
    import('@opentelemetry/instrumentation-express'),
    import('@opentelemetry/instrumentation-pg'),
    import('@opentelemetry/instrumentation-pino'),
    import('@opentelemetry/instrumentation-undici'),
  ]);

  const quiet = /^\/(health|metrics)(\/|$)|^\/api\/v1\/health(\/|$)/;

  const sdk = new NodeSDK({
    // Solo trazas: las métricas van por /metrics (Prometheus) y los logs por Docker → Alloy
    metricReaders: [],
    logRecordProcessors: [],
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => quiet.test(req.url ?? ''),
        requireParentforOutgoingSpans: true,
      }),
      new ExpressInstrumentation(),
      new PgInstrumentation({ requireParentSpan: true, ignoreConnectSpans: true }),
      new PinoInstrumentation(),
      new UndiciInstrumentation({ requireParentforSpans: true }),
    ],
  });
  sdk.start();

  // Lo que quede en el buffer sale antes de cerrar (el SIGTERM de docker stop)
  const shutdown = () => sdk.shutdown().catch(() => {});
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
