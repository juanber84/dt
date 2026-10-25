// Dashboard "TwinMe · Estado": de arriba abajo, de lo que importa ya (¿funciona?) a lo que sirve
// para entender por qué. Arriba indicadores con texto (no solo color); debajo series de pocas
// líneas, un solo eje por gráfica; al final logs y trazas de error para ir al detalle.

const PROM = { type: 'prometheus', uid: 'grafanacloud-prom' };
const LOGS = { type: 'loki', uid: 'grafanacloud-logs' };
const TRACES = { type: 'tempo', uid: 'grafanacloud-traces' };

const GREEN = 'green';
const RED = 'red';
const ORANGE = 'orange';

let nextId = 1;

/** Ok/caído con texto: 1 = verde "Funciona", 0 = rojo "Caído". */
function upStat(title, expr, gridPos, description) {
  return {
    id: nextId++,
    type: 'stat',
    title,
    description,
    gridPos,
    datasource: PROM,
    targets: [{ refId: 'A', datasource: PROM, expr, instant: true }],
    options: {
      reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
      colorMode: 'background',
      graphMode: 'none',
      textMode: 'value',
      justifyMode: 'center',
    },
    fieldConfig: {
      defaults: {
        unit: 'none',
        noValue: 'Sin datos',
        color: { mode: 'thresholds' },
        thresholds: {
          mode: 'absolute',
          steps: [
            { color: RED, value: null },
            { color: ORANGE, value: 0.5 },
            { color: GREEN, value: 0.99 },
          ],
        },
        mappings: [
          {
            type: 'range',
            options: { from: 0.99, to: 1.01, result: { text: '✓ Funciona', index: 0 } },
          },
          {
            type: 'range',
            options: { from: 0.5, to: 0.99, result: { text: '! A ratos', index: 1 } },
          },
          { type: 'range', options: { from: -1, to: 0.5, result: { text: '✕ Caído', index: 2 } } },
        ],
      },
      overrides: [],
    },
  };
}

function stat(title, targets, gridPos, defaults, description) {
  return {
    id: nextId++,
    type: 'stat',
    title,
    description,
    gridPos,
    datasource: targets[0].datasource,
    targets,
    options: {
      reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
      colorMode: 'value',
      graphMode: 'none',
      textMode: 'value',
      justifyMode: 'center',
    },
    fieldConfig: { defaults: { noValue: 'Sin datos', ...defaults }, overrides: [] },
  };
}

function series(title, targets, gridPos, defaults = {}, { stack = false, bars = false } = {}) {
  return {
    id: nextId++,
    type: 'timeseries',
    title,
    gridPos,
    datasource: targets[0].datasource,
    targets,
    options: {
      legend: { displayMode: 'list', placement: 'bottom', showLegend: true },
      tooltip: { mode: 'multi', sort: 'desc' },
    },
    fieldConfig: {
      defaults: {
        color: { mode: 'palette-classic' },
        custom: {
          drawStyle: bars ? 'bars' : 'line',
          lineWidth: 2,
          fillOpacity: bars ? 80 : 8,
          showPoints: 'never',
          spanNulls: false,
          stacking: { mode: stack ? 'normal' : 'none', group: 'A' },
          axisSoftMin: 0,
        },
        ...defaults,
      },
      overrides: [],
    },
  };
}

function row(title, y) {
  return {
    id: nextId++,
    type: 'row',
    title,
    collapsed: false,
    gridPos: { h: 1, w: 24, x: 0, y },
    panels: [],
  };
}

const prom = (expr, legendFormat, extra = {}) => ({
  refId: String.fromCharCode(65 + (extra.index ?? 0)),
  datasource: PROM,
  expr,
  legendFormat,
  range: true,
  ...extra,
});

export function buildDashboard() {
  nextId = 1;
  const panels = [
    // ------------------------------------------------------------------- Ahora mismo
    row('Ahora mismo', 0),
    upStat(
      'Desde fuera',
      'avg(avg_over_time(probe_success{job="twinme-ready"}[6m]))',
      { h: 4, w: 4, x: 0, y: 1 },
      'twinme.app/api/v1/health/ready desde España, París y Frankfurt (pasa por Cloudflare y el túnel)',
    ),
    upStat(
      'API',
      'up{job="digitaltwin-api"}',
      { h: 4, w: 4, x: 4, y: 1 },
      'Alloy lee /metrics de la API dentro del VPS',
    ),
    upStat(
      'Worker',
      'digitaltwin_service_up{service="worker"}',
      { h: 4, w: 4, x: 8, y: 1 },
      'Latido del worker en la BD',
    ),
    upStat(
      'Bot',
      'digitaltwin_service_up{service="bot"}',
      { h: 4, w: 4, x: 12, y: 1 },
      'Latido del bot de Telegram',
    ),
    stat(
      'Última copia',
      [
        prom('time() - digitaltwin_backup_last_success_timestamp_seconds', '', {
          instant: true,
          range: false,
        }),
      ],
      { h: 4, w: 4, x: 16, y: 1 },
      {
        unit: 's',
        decimals: 0,
        color: { mode: 'thresholds' },
        thresholds: {
          mode: 'absolute',
          steps: [
            { color: GREEN, value: null },
            { color: RED, value: 26 * 3600 },
          ],
        },
      },
      'Hace cuánto acabó bien el último backup (sale a las 04:00)',
    ),
    stat(
      'Errores (24 h)',
      [
        {
          refId: 'A',
          datasource: LOGS,
          expr: 'sum(count_over_time({container=~"digitaltwin-.+", level=~"error|fatal"}[24h]))',
          queryType: 'instant',
        },
      ],
      { h: 4, w: 4, x: 20, y: 1 },
      {
        unit: 'short',
        noValue: '0',
        color: { mode: 'thresholds' },
        thresholds: {
          mode: 'absolute',
          steps: [
            { color: GREEN, value: null },
            { color: ORANGE, value: 1 },
            { color: RED, value: 20 },
          ],
        },
      },
      'Líneas de error en los logs de API, worker y bot',
    ),

    // -------------------------------------------------------------------- Desde fuera
    row('Desde fuera', 5),
    series(
      'Tiempo de respuesta por sonda',
      [prom('avg by (probe) (probe_duration_seconds{job="twinme-ready"})', '{{probe}}')],
      { h: 7, w: 16, x: 0, y: 6 },
      { unit: 's' },
    ),
    stat(
      'Disponibilidad en el rango',
      [
        prom('avg(avg_over_time(probe_success{job="twinme-ready"}[$__range]))', '', {
          instant: true,
          range: false,
        }),
      ],
      { h: 7, w: 8, x: 16, y: 6 },
      {
        unit: 'percentunit',
        decimals: 2,
        color: { mode: 'thresholds' },
        thresholds: {
          mode: 'absolute',
          steps: [
            { color: RED, value: null },
            { color: ORANGE, value: 0.99 },
            { color: GREEN, value: 0.999 },
          ],
        },
      },
      'Porcentaje de comprobaciones buenas en el rango elegido arriba',
    ),

    // ------------------------------------------------------------------------- La API
    row('API', 13),
    series(
      'Peticiones por minuto',
      [
        prom(
          'sum by (class) (label_replace(rate(digitaltwin_http_request_duration_seconds_count[5m]), "class", "${1}xx", "status", "(\\\\d).."))*60',
          '{{class}}',
        ),
      ],
      { h: 7, w: 8, x: 0, y: 14 },
      { unit: 'short' },
      { stack: true },
    ),
    series(
      'Latencia p95',
      [
        prom(
          'histogram_quantile(0.95, sum by (le) (rate(digitaltwin_http_request_duration_seconds_bucket{route!="unmatched"}[5m])))',
          'p95',
        ),
      ],
      { h: 7, w: 8, x: 8, y: 14 },
      { unit: 's' },
    ),
    {
      id: nextId++,
      type: 'table',
      title: 'Rutas más lentas (p95, rango elegido)',
      gridPos: { h: 7, w: 8, x: 16, y: 14 },
      datasource: PROM,
      targets: [
        prom(
          'topk(8, histogram_quantile(0.95, sum by (le, route) (rate(digitaltwin_http_request_duration_seconds_bucket{route!="unmatched"}[$__range]))))',
          '{{route}}',
          { instant: true, range: false, format: 'table' },
        ),
      ],
      transformations: [
        {
          id: 'organize',
          options: { excludeByName: { Time: true }, renameByName: { Value: 'p95' } },
        },
      ],
      fieldConfig: { defaults: { unit: 's', decimals: 2 }, overrides: [] },
      options: { showHeader: true, sortBy: [{ displayName: 'p95', desc: true }] },
    },

    // ----------------------------------------------------------------- Worker y colas
    row('Worker y colas', 21),
    series(
      'Trabajos hechos por hora',
      [
        prom(
          'sum by (queue) (increase(digitaltwin_worker_jobs_total{result="done"}[1h]))',
          '{{queue}}',
        ),
      ],
      { h: 7, w: 8, x: 0, y: 22 },
      { unit: 'short' },
      { stack: true, bars: true },
    ),
    series(
      'Trabajos fallidos por hora',
      [
        prom(
          'sum by (queue) (increase(digitaltwin_worker_jobs_total{result="failed"}[1h])) > 0',
          '{{queue}}',
        ),
        // Intentos que fallaron pero pg-boss repite: avisan de un proveedor inestable
        prom(
          'sum by (queue) (increase(digitaltwin_worker_jobs_total{result="retried"}[1h])) > 0',
          '{{queue}} (reintento)',
        ),
      ],
      { h: 7, w: 8, x: 8, y: 22 },
      { unit: 'short' },
      { stack: true, bars: true },
    ),
    series(
      'Esperando en cola',
      [prom('sum by (queue) (digitaltwin_queue_jobs{state=~"ready|active"}) > 0', '{{queue}}')],
      { h: 7, w: 8, x: 16, y: 22 },
      { unit: 'short' },
    ),

    // ------------------------------------------------------------------------- Servidor
    row('Servidor (VPS compartido)', 29),
    series(
      'CPU',
      [
        prom(
          '1 - avg(rate(node_cpu_seconds_total{job="integrations/unix", mode="idle"}[5m]))',
          'uso',
        ),
      ],
      { h: 7, w: 6, x: 0, y: 30 },
      { unit: 'percentunit', max: 1 },
    ),
    series(
      'RAM disponible',
      [prom('node_memory_MemAvailable_bytes{job="integrations/unix"}', 'disponible')],
      { h: 7, w: 6, x: 6, y: 30 },
      { unit: 'bytes' },
    ),
    series(
      'Disco usado (/)',
      [
        prom(
          '1 - node_filesystem_avail_bytes{job="integrations/unix", mountpoint="/"} / node_filesystem_size_bytes{job="integrations/unix", mountpoint="/"}',
          'usado',
        ),
      ],
      { h: 7, w: 6, x: 12, y: 30 },
      { unit: 'percentunit', max: 1 },
    ),
    series(
      'Carga (1 min)',
      [prom('node_load1{job="integrations/unix"}', 'load1')],
      { h: 7, w: 6, x: 18, y: 30 },
      { unit: 'short' },
    ),

    // ----------------------------------------------------------------------- Contenedores
    row('Contenedores digitaltwin-*', 37),
    series(
      'Memoria por contenedor',
      [
        prom(
          'sum by (name) (container_memory_working_set_bytes{name=~"digitaltwin-.+"})',
          '{{name}}',
        ),
      ],
      { h: 8, w: 12, x: 0, y: 38 },
      { unit: 'bytes' },
    ),
    series(
      'CPU por contenedor',
      [
        prom(
          'sum by (name) (rate(container_cpu_usage_seconds_total{name=~"digitaltwin-.+"}[5m]))',
          '{{name}}',
        ),
      ],
      { h: 8, w: 12, x: 12, y: 38 },
      { unit: 'short', decimals: 2 },
    ),

    // ------------------------------------------------------------------- Logs y trazas
    row('Logs y trazas', 46),
    {
      id: nextId++,
      type: 'logs',
      title: 'Errores y avisos',
      gridPos: { h: 10, w: 24, x: 0, y: 47 },
      datasource: LOGS,
      targets: [
        {
          refId: 'A',
          datasource: LOGS,
          expr: '{container=~"digitaltwin-.+", level=~"warn|error|fatal"}',
          queryType: 'range',
        },
      ],
      options: {
        showTime: true,
        wrapLogMessage: true,
        sortOrder: 'Descending',
        enableLogDetails: true,
        dedupStrategy: 'none',
      },
    },
    {
      id: nextId++,
      type: 'table',
      title: 'Trazas con error',
      gridPos: { h: 8, w: 12, x: 0, y: 57 },
      datasource: TRACES,
      targets: [
        {
          refId: 'A',
          datasource: TRACES,
          queryType: 'traceql',
          query: '{ resource.service.name =~ "digitaltwin-.+" && status = error }',
          limit: 20,
          tableType: 'traces',
        },
      ],
    },
    {
      id: nextId++,
      type: 'table',
      title: 'Trazas más lentas (> 2 s)',
      gridPos: { h: 8, w: 12, x: 12, y: 57 },
      datasource: TRACES,
      targets: [
        {
          refId: 'A',
          datasource: TRACES,
          queryType: 'traceql',
          query: '{ resource.service.name =~ "digitaltwin-.+" && duration > 2s }',
          limit: 20,
          tableType: 'traces',
        },
      ],
    },
  ];

  return {
    uid: 'twinme-status',
    title: 'TwinMe · Estado',
    tags: ['twinme'],
    timezone: 'Europe/Madrid',
    refresh: '1m',
    time: { from: 'now-24h', to: 'now' },
    schemaVersion: 39,
    editable: true,
    panels,
  };
}
