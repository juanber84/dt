// Alertas de TwinMe (Grafana-managed). Cada una es una consulta que devuelve algo > 0 cuando hay
// que avisar; `for` es cuánto tiene que durar antes de mandar el correo. Todas llevan
// project=twinme, que es lo que la política de avisos manda al correo (ver provision.js).
// La uid es fija: volver a provisionar actualiza la regla en vez de duplicarla.

const PROM = 'grafanacloud-prom';
const LOGS = 'grafanacloud-logs';

/**
 * @typedef {object} Alert
 * @property {string} uid
 * @property {string} title
 * @property {string} expr          PromQL o LogQL; avisa si el resultado es > threshold (o
 *   < below).
 * @property {number} [below]
 * @property {string} [datasource]  Por defecto, Prometheus.
 * @property {number} [threshold]
 * @property {string} for
 * @property {'critical'|'warning'} severity
 * @property {string} summary       Lo que dice el correo.
 * @property {'Alerting'|'OK'|'NoData'} [noData]  Si la consulta no devuelve nada. Por defecto OK:
 *   que falten métricas lo avisa twinme-no-metrics, una sola vez y no una por regla.
 * @property {number} [window]      Segundos hacia atrás que mira la consulta (para Loki).
 */

/** @type {Alert[]} */
export const ALERTS = [
  // ------------------------------------------------------------------------ Desde fuera
  {
    uid: 'twinme-down',
    title: 'TwinMe caída desde fuera',
    // Media de las sondas en 6 min: con la mitad fallando ya no es una sonda con mala red
    expr: '1 - avg(avg_over_time(probe_success{job="twinme-ready"}[6m]))',
    threshold: 0.5,
    for: '2m',
    severity: 'critical',
    summary:
      'https://twinme.app/api/v1/health/ready no responde bien desde España/París/Frankfurt. Mira si es el VPS (resto de alertas), el túnel o Cloudflare.',
    noData: 'Alerting',
  },
  {
    uid: 'twinme-web-down',
    title: 'Frontal de TwinMe caído desde fuera',
    expr: '1 - avg(avg_over_time(probe_success{job="twinme-web"}[15m]))',
    threshold: 0.5,
    for: '5m',
    severity: 'critical',
    summary: 'https://twinme.app/ no devuelve la web (nginx de digitaltwin-web o Cloudflare).',
  },
  {
    uid: 'twinme-cert',
    title: 'Certificado de twinme.app a punto de caducar',
    // Días que le quedan
    expr: '(min(probe_ssl_earliest_cert_expiry{job="twinme-ready"}) - time()) / 86400',
    below: 14,
    for: '1h',
    severity: 'warning',
    summary:
      'El certificado HTTPS caduca en menos de 14 días (lo renueva Cloudflare: revisa el dominio).',
  },

  // ---------------------------------------------------------------------------- El VPS
  {
    uid: 'twinme-no-metrics',
    title: 'No llegan métricas del VPS',
    // Si Alloy deja de mandar, el resto de alertas internas se quedan sin datos y no saltarían
    expr: 'absent_over_time(up{job="digitaltwin-api"}[10m])',
    for: '5m',
    severity: 'critical',
    summary:
      'digitaltwin-alloy no manda nada a Grafana desde hace 10 min: el VPS, el contenedor de Alloy o su token.',
  },
  {
    uid: 'twinme-api-down',
    title: 'La API no responde dentro del VPS',
    expr: '1 - up{job="digitaltwin-api"}',
    for: '3m',
    severity: 'critical',
    summary: 'digitaltwin-alloy no puede leer /metrics de digitaltwin-api.',
  },
  {
    uid: 'twinme-worker-down',
    title: 'El worker no late',
    expr: '1 - digitaltwin_service_up{service="worker"}',
    for: '5m',
    severity: 'critical',
    summary:
      'digitaltwin-worker ha perdido tres latidos: no se sincroniza, no se normaliza y no hay backup ni informes.',
  },
  {
    uid: 'twinme-bot-down',
    title: 'El bot de Telegram no late',
    expr: '1 - digitaltwin_service_up{service="bot"}',
    for: '10m',
    severity: 'warning',
    summary: 'digitaltwin-bot no avisa a la API: las comidas y el agua por Telegram no entran.',
  },
  {
    uid: 'twinme-5xx',
    title: 'Errores 5xx en la API',
    expr: 'sum(increase(digitaltwin_http_request_duration_seconds_count{status=~"5.."}[15m]))',
    threshold: 5,
    for: '0s',
    severity: 'warning',
    summary: 'Más de 5 respuestas 5xx en 15 min. Los logs de error en Grafana dicen cuáles.',
  },
  {
    uid: 'twinme-jobs-failed',
    title: 'Trabajos del worker fallando',
    expr: 'sum by (queue) (increase(digitaltwin_worker_jobs_total{result="failed"}[30m]))',
    threshold: 3,
    for: '0s',
    severity: 'warning',
    // Solo los que se dan por perdidos: los intentos que pg-boss repite (result="retried") no cuentan
    summary:
      'Más de 3 trabajos fallidos (agotados sus reintentos) en 30 min en la cola {{ $labels.queue }}.',
  },
  {
    uid: 'twinme-queue-stuck',
    title: 'Cola atascada',
    // Las cargas iniciales (fetch, backfill, normalize) pueden tener miles: no cuentan
    expr: 'sum by (queue) (digitaltwin_queue_jobs{state="ready", queue!~"fetch|backfill|normalize"})',
    threshold: 50,
    for: '30m',
    severity: 'warning',
    summary: 'La cola {{ $labels.queue }} lleva 30 min con más de 50 trabajos esperando.',
  },
  {
    uid: 'twinme-backup',
    title: 'Sin copia de seguridad reciente',
    // Sale a las 04:00: con 26 h hay margen para un día que tarde
    expr: '(time() - digitaltwin_backup_last_success_timestamp_seconds > 26 * 3600) or (digitaltwin_backup_last_failed == 1)',
    threshold: 0,
    for: '15m',
    severity: 'critical',
    summary:
      'La última copia buena es de hace más de 26 h, o la última falló. Mira Sistema en la web.',
  },
  {
    uid: 'twinme-errors-logs',
    title: 'Muchos errores en los logs',
    datasource: LOGS,
    expr: 'sum(count_over_time({container=~"digitaltwin-.+", level=~"error|fatal"}[15m]))',
    threshold: 10,
    window: 900,
    for: '0s',
    severity: 'warning',
    summary: 'Más de 10 líneas de error en 15 min en los contenedores digitaltwin-*.',
  },

  // ------------------------------------------------------------------------- Servidor
  {
    uid: 'twinme-disk',
    title: 'Disco del VPS casi lleno',
    expr: '1 - node_filesystem_avail_bytes{job="integrations/unix", mountpoint="/"} / node_filesystem_size_bytes{job="integrations/unix", mountpoint="/"}',
    threshold: 0.9,
    for: '15m',
    severity: 'warning',
    summary: 'El disco del VPS está por encima del 90%.',
  },
  {
    uid: 'twinme-memory',
    title: 'VPS sin memoria',
    expr: '1 - node_memory_MemAvailable_bytes{job="integrations/unix"} / node_memory_MemTotal_bytes{job="integrations/unix"}',
    threshold: 0.95,
    for: '10m',
    severity: 'warning',
    summary: 'Queda menos del 5% de RAM disponible en el VPS (lo comparten varios proyectos).',
  },
  {
    uid: 'twinme-oom',
    title: 'Contenedor de TwinMe sin memoria (OOM)',
    expr: 'sum by (name) (increase(container_oom_events_total{name=~"digitaltwin-.+"}[10m]))',
    threshold: 0,
    for: '0s',
    severity: 'warning',
    summary: '{{ $labels.name }} se ha quedado sin memoria (mem_limit del compose).',
  },
];

/** Regla de Grafana (API de provisioning) a partir de la definición de arriba. */
export function toGrafanaRule(alert, folderUid, group) {
  const datasourceUid = alert.datasource ?? PROM;
  const isLoki = datasourceUid === LOGS;
  return {
    uid: alert.uid,
    title: alert.title,
    folderUID: folderUid,
    ruleGroup: group,
    condition: 'C',
    for: alert.for,
    noDataState: alert.noData ?? 'OK',
    execErrState: 'Error',
    labels: { project: 'twinme', severity: alert.severity },
    annotations: { summary: alert.summary },
    data: [
      {
        refId: 'A',
        datasourceUid,
        relativeTimeRange: { from: alert.window ?? 600, to: 0 },
        model: isLoki
          ? { refId: 'A', expr: alert.expr, queryType: 'instant', editorMode: 'code' }
          : { refId: 'A', expr: alert.expr, instant: true, range: false, editorMode: 'code' },
      },
      {
        refId: 'B',
        datasourceUid: '__expr__',
        model: {
          refId: 'B',
          type: 'reduce',
          expression: 'A',
          reducer: 'last',
          settings: { mode: 'dropNN' },
        },
      },
      {
        refId: 'C',
        datasourceUid: '__expr__',
        model: {
          refId: 'C',
          type: 'threshold',
          expression: 'B',
          conditions: [
            {
              evaluator:
                alert.below === undefined
                  ? { type: 'gt', params: [alert.threshold ?? 0] }
                  : { type: 'lt', params: [alert.below] },
            },
          ],
        },
      },
    ],
  };
}
