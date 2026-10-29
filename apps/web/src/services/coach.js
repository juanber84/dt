import { apiFetch, apiStream } from '../api.js';
import { formatShortDate } from '../lib/dates.js';

/** Conversaciones con el coach (la más reciente primero). 404 = el coach no está montado. */
export const listConversations = () => apiFetch('/api/v1/coach/conversations').then((r) => r.items);

export const getConversation = (id) => apiFetch(`/api/v1/coach/conversations/${id}`);

export const deleteConversation = (id) =>
  apiFetch(`/api/v1/coach/conversations/${id}`, { method: 'DELETE' });

/**
 * Pregunta al coach. `onEvent(event, data)` recibe el stream: conversation, user, tool,
 * tool_result, delta, message, done, error.
 * @param {{ conversationId?: string, text: string, context?: { date?: string } }} body
 */
export const sendMessage = (body, onEvent, options) =>
  apiStream('/api/v1/coach/messages', body, onEvent, options);

/** Qué hace cada herramienta, dicho para personas (las chips de "ha consultado…"). */
const TOOL_LABELS = {
  list_metrics: () => 'Qué datos hay',
  get_series: (a) => `Series ${a.from && a.to ? `${a.from} → ${a.to}` : ''}`.trim(),
  get_episodes: (a) => `Comidas, entrenos y sueño ${a.from ?? ''}`.trim(),
  get_observations: (a) => `Datos crudos ${a.from ?? ''}`.trim(),
  get_day_summary: (a) => `Resumen del día ${a.date ?? 'de hoy'}`,
  show_chart: (a) => `Gráfica${a.title ? `: ${a.title}` : ''}`,
  get_strength_sets: (a) => `Entrenos de fuerza ${a.from ?? ''}`.trim(),
  list_strength_templates: () => 'Tus plantillas',
  get_strength_template: () => 'Una plantilla',
  search_exercises: (a) => `Ejercicios${a.query ? `: ${a.query}` : ''}`,
  propose_strength_template: (a) => `Plantilla${a.name ? `: ${a.name}` : ''}`,
};

/**
 * Guarda en su app la plantilla de fuerza que propuso el coach en ese mensaje (la guardada en el
 * servidor, no lo que haya aquí). Devuelve el display actualizado, con `saved`.
 */
export const applyTemplate = (messageId) =>
  apiFetch(`/api/v1/coach/messages/${messageId}/apply`, { method: 'POST' }).then((r) => r.display);

/** Una serie en corto: "8 × 70 kg", "12", "45 s". */
export function setLabel({ reps, weightKg, timeS } = {}) {
  const kg = weightKg > 0 ? ` × ${String(weightKg).replace('.', ',')} kg` : '';
  if (reps != null) return `${reps}${kg}`;
  if (timeS != null) return `${timeS} s${kg}`;
  return '?';
}

export function toolLabel(name, args = {}) {
  return TOOL_LABELS[name]?.(args ?? {}) ?? name;
}

/**
 * Mensajes guardados → lo que se pinta: cada pregunta y una respuesta por pregunta, con el texto
 * de todas las vueltas del asistente, las herramientas que usó y las gráficas y plantillas que
 * enseñó (de los demás resultados no se enseña nada). Cada una guarda en `at` por dónde iba el
 * texto; las plantillas, también el mensaje guardado (`messageId`) para su botón.
 */
export function toChat(messages) {
  const out = [];
  let answer = null;
  for (const m of messages) {
    if (m.role === 'user') {
      answer = null;
      out.push({ id: m.id, role: 'user', content: m.content, context: m.meta?.context });
    } else if (m.role === 'assistant') {
      if (!answer) {
        answer = { id: m.id, role: 'assistant', content: '', tools: [], charts: [] };
        out.push(answer);
      }
      answer.id = m.id;
      for (const call of m.toolCalls ?? []) {
        answer.tools.push({
          id: call.id,
          name: call.function.name,
          args: parseArgs(call),
          ok: true,
        });
      }
      if (m.content) answer.content += (answer.content ? '\n\n' : '') + m.content;
    } else if (m.role === 'tool' && answer) {
      if (m.content.startsWith('Error')) {
        const tool = answer.tools.find((t) => t.id === m.toolCallId);
        if (tool) tool.ok = false;
      }
      if (m.meta?.display?.type === 'chart') addChart(answer, m.toolCallId, m.meta.display);
      if (m.meta?.display?.type === 'strength-template') {
        addTemplate(answer, m.toolCallId, m.meta.display, m.id);
      }
    }
  }
  return out;
}

/**
 * Un evento del stream sobre la respuesta que se está escribiendo (`answer`, reactiva): las
 * herramientas que usa, sus gráficas, el texto y los errores. `conversation` no toca la respuesta
 * (es de la lista de conversaciones) y `user`/`done` no traen nada que pintar.
 */
export function applyEvent(answer, event, data) {
  switch (event) {
    case 'tool':
      answer.tools.push({ id: data.id, name: data.name, args: data.args, ok: null });
      break;
    case 'tool_result': {
      const tool = answer.tools.find((t) => t.id === data.id);
      if (tool) tool.ok = data.ok;
      if (data.display?.type === 'chart') addChart(answer, data.id, data.display);
      if (data.display?.type === 'strength-template') addTemplate(answer, data.id, data.display);
      break;
    }
    case 'display': {
      // Ya guardado el mensaje de la tarjeta: con su id funciona el botón
      const entry = answer.charts.find((c) => c.id === data.toolCallId);
      if (entry) entry.messageId = data.id;
      break;
    }
    case 'delta':
      answer.content += data.text;
      break;
    case 'message':
      // Texto antes de llamar a herramientas: lo siguiente va en otro párrafo
      if (data.content && data.toolCalls) answer.content += '\n\n';
      answer.id = data.id;
      break;
    case 'error':
      answer.error = data.message;
      break;
  }
}

/** Una gráfica nueva en la respuesta, donde va el texto en este momento. */
export function addChart(answer, id, chart) {
  answer.charts.push({ id, at: answer.content.length, chart });
}

/** Una plantilla propuesta: va en el mismo hilo que las gráficas, con su mensaje (si ya lo hay). */
export function addTemplate(answer, id, template, messageId = null) {
  answer.charts.push({ id, at: answer.content.length, template, messageId });
}

/**
 * La respuesta en trozos para pintarla: texto, gráficas y plantillas en el orden en que llegaron.
 * El texto se corta por los saltos de párrafo que hay entre vueltas, así el Markdown no queda
 * partido. Una plantilla lleva su entrada entera (`entry`), que la tarjeta actualiza al guardar.
 * @returns {Array<{ type: 'text', key: string, text: string } | { type: 'chart', key: string, chart: object } | { type: 'template', key: string, entry: object }>}
 */
export function answerParts(answer) {
  const parts = [];
  let from = 0;
  for (const entry of answer.charts ?? []) {
    const { id, at, chart } = entry;
    const text = answer.content.slice(from, at).trim();
    if (text) parts.push({ type: 'text', key: `t${from}`, text });
    parts.push(
      entry.template ? { type: 'template', key: id, entry } : { type: 'chart', key: id, chart },
    );
    from = Math.max(from, at);
  }
  const rest = answer.content.slice(from).trim();
  if (rest) parts.push({ type: 'text', key: `t${from}`, text: rest });
  return parts;
}

// Orden fijo: cada serie conserva su color aunque cambie cuántas hay
const CHART_COLORS = ['var(--sleep)', 'var(--activity)', 'var(--nutrition)', 'var(--hr-line)'];
const AVERAGE_DAYS = 7;

/**
 * Una gráfica de show_chart → lo que pintan LineChart/BarChart. Una por unidad (nunca dos ejes):
 * peso y grasa salen una debajo de otra. Columnas solo con una serie (apiladas sumarían cosas que
 * no se suman); con la media de 7 días, el dato diario va en gris y la media en color.
 */
export function chartGroups(chart) {
  const colored = chart.series.map((s, i) => ({
    ...s,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));
  const units = [...new Set(colored.map((s) => s.unit ?? ''))];
  return units.map((unit) => {
    const group = colored.filter((s) => (s.unit ?? '') === unit);
    const single = group.length === 1 ? group[0] : null;
    const kind = chart.kind === 'bar' && single ? 'bar' : 'line';
    const series =
      single && kind === 'line' && chart.average
        ? [
            {
              id: `${single.code}-day`,
              label: single.label,
              color: 'var(--axis)',
              values: single.values,
            },
            {
              id: `${single.code}-avg`,
              label: `Media de ${AVERAGE_DAYS} días`,
              color: single.color,
              values: rollingMean(single.values, AVERAGE_DAYS),
            },
          ]
        : group.map((s) => ({ id: s.code, label: s.label, color: s.color, values: s.values }));
    const values = group.flatMap((s) => s.values).filter((v) => v != null);
    const top = Math.max(...values.map(Math.abs), 0);
    const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    return {
      key: unit || group[0].code,
      title: group.map((s) => s.label).join(' · '),
      unit,
      kind,
      series,
      legend: series.length > 1 ? series.map(({ label, color }) => ({ label, color })) : [],
      decimals: top < 100 ? 1 : 0,
      // Sin un alto mínimo, 81–82 kg ocupa toda la gráfica y una oscilación normal parece enorme
      minSpan: kind === 'line' ? Math.abs(mean) * 0.04 : 0,
    };
  });
}

/** Etiquetas del eje: el día ("12 oct") o la hora (con el día delante si hay más de uno). */
export function chartLabels(chart) {
  if (chart.bucket === 'day') return chart.labels.map(formatShortDate);
  const days = new Set(chart.labels.map((t) => t.slice(0, 10)));
  return chart.labels.map((t) =>
    days.size > 1 ? `${formatShortDate(t.slice(0, 10))} ${t.slice(11)}` : t.slice(11),
  );
}

/** Media de los últimos `n` días con dato (al menos 3; si no, hueco). */
export function rollingMean(values, n) {
  return values.map((_, i) => {
    const window = values.slice(Math.max(0, i - n + 1), i + 1).filter((v) => v != null);
    return window.length >= 3 ? window.reduce((a, b) => a + b, 0) / window.length : null;
  });
}

function parseArgs(call) {
  try {
    return JSON.parse(call.function.arguments || '{}');
  } catch {
    return {};
  }
}
