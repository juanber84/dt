import { Resvg } from '@resvg/resvg-js';
import { formatNumber } from './blocks.js';

// Más ancha que lo que se ve en el correo (hasta 512 px), para que se vea nítida, pero no tanto
// que la letra quede diminuta en el móvil
const WIDTH = 760;
const HEIGHT = 380;
const PAD = { top: 70, right: 20, bottom: 58, left: 92 };
const COLORS = ['#2f6f4f', '#9a9a92', '#c47f2c', '#4a6fa5'];
const FONT = 'DejaVu Sans, Helvetica, Arial, sans-serif';

const esc = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "22/10" de "2026-10-22"; por hora, "14:00". */
function shortLabel(label, bucket) {
  if (bucket === 'hour') return label.slice(11, 16);
  const [, m, d] = label.split('-');
  return `${Number(d)}/${Number(m)}`;
}

/** Entre 3 y 5 marcas "redondas" que cubran [min, max]. */
function ticks(min, max) {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => span / s <= 5) ?? raw;
  const out = [];
  for (let v = Math.floor(min / step) * step; v <= max + step / 2; v += step) out.push(v);
  return out;
}

/**
 * La gráfica de un bloque `chart` como SVG (línea o barras, eje Y compartido). Los huecos (null)
 * cortan la línea: no se rellenan.
 * @param {{ title: string, bucket: string, kind: 'line' | 'bar', labels: string[], series: Array<{ label: string, unit: string, values: Array<number | null> }>, target?: { value: number, label?: string } }} chart
 */
export function chartSvg(chart) {
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const n = chart.labels.length;
  const target = chart.target?.value ?? null;
  const values = [...chart.series.flatMap((s) => s.values), target].filter((v) => v != null);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (chart.kind === 'bar') min = Math.min(0, min);
  else {
    const pad = (max - min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const marks = ticks(min, max);
  min = Math.min(min, marks[0]);
  max = Math.max(max, marks.at(-1));
  const digits = max - min < 10 ? 1 : 0;

  const x = (i) =>
    chart.kind === 'bar'
      ? PAD.left + ((i + 0.5) * plotW) / n
      : PAD.left + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v) => PAD.top + plotH - ((v - min) / (max - min)) * plotH;
  const parts = [];

  parts.push(
    `<text x="${PAD.left}" y="38" font-size="30" font-weight="bold" fill="#1c1c1a">${esc(chart.title)}</text>`,
  );
  const unit = chart.series[0]?.unit ?? '';
  for (const v of marks) {
    parts.push(
      `<line x1="${PAD.left}" x2="${WIDTH - PAD.right}" y1="${y(v)}" y2="${y(v)}" stroke="#e6e6e1" stroke-width="2"/>`,
      `<text x="${PAD.left - 14}" y="${y(v) + 8}" font-size="24" text-anchor="end" fill="#6b6b66">${esc(formatNumber(v, digits))}</text>`,
    );
  }
  parts.push(
    `<text x="${PAD.left - 14}" y="${PAD.top - 18}" font-size="22" text-anchor="end" fill="#8a8a84">${esc(unit)}</text>`,
  );
  // Fechas: la primera, la del medio y la última
  for (const i of [...new Set([0, Math.floor((n - 1) / 2), n - 1])]) {
    // En las barras, centrada bajo la suya; en la línea, la primera y la última pegadas al borde
    const anchor =
      chart.kind === 'bar' || n === 1
        ? 'middle'
        : i === 0
          ? 'start'
          : i === n - 1
            ? 'end'
            : 'middle';
    parts.push(
      `<text x="${x(i)}" y="${HEIGHT - 18}" font-size="24" text-anchor="${anchor}" fill="#6b6b66">${esc(shortLabel(chart.labels[i], chart.bucket))}</text>`,
    );
  }

  chart.series.forEach((s, si) => {
    const color = COLORS[si % COLORS.length];
    if (chart.kind === 'bar') {
      const width = Math.max(4, (plotW / n) * (0.6 / chart.series.length));
      s.values.forEach((v, i) => {
        if (v == null) return;
        const bx = x(i) - (width * chart.series.length) / 2 + si * width;
        const top = y(Math.max(v, 0));
        const height = Math.abs(y(v) - y(0));
        parts.push(
          `<rect x="${bx}" y="${top}" width="${width}" height="${Math.max(height, 1)}" rx="4" fill="${color}"/>`,
        );
      });
      return;
    }
    // Puntos sueltos (el peso de cada día, con huecos): sin línea que los una
    if (s.style === 'points') {
      s.values.forEach((v, i) => {
        if (v != null) parts.push(`<circle cx="${x(i)}" cy="${y(v)}" r="6" fill="${color}"/>`);
      });
      return;
    }
    // Línea: un tramo por cada racha sin huecos
    let path = '';
    let open = false;
    s.values.forEach((v, i) => {
      if (v == null) {
        open = false;
        return;
      }
      path += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      open = true;
    });
    const dashed = si > 0 ? ' stroke-dasharray="10 8"' : '';
    parts.push(
      `<path d="${path.trim()}" fill="none" stroke="${color}" stroke-width="${si === 0 ? 5 : 4}" stroke-linejoin="round" stroke-linecap="round"${dashed}/>`,
    );
    if (si === 0 && n <= 45) {
      s.values.forEach((v, i) => {
        if (v != null) parts.push(`<circle cx="${x(i)}" cy="${y(v)}" r="5" fill="${color}"/>`);
      });
    }
  });

  if (target != null) {
    // La línea cruza el gráfico; su etiqueta va arriba a la derecha, como leyenda (sobre las
    // barras no se leería)
    const text = `${chart.target.label ?? 'Objetivo'} ${formatNumber(target, digits)}`;
    const lx = WIDTH - PAD.right - text.length * 12 - 44;
    parts.push(
      `<line x1="${PAD.left}" x2="${WIDTH - PAD.right}" y1="${y(target)}" y2="${y(target)}" stroke="#c47f2c" stroke-width="3" stroke-dasharray="12 8"/>`,
      `<line x1="${lx}" x2="${lx + 32}" y1="57" y2="57" stroke="#c47f2c" stroke-width="3" stroke-dasharray="8 6"/>`,
      `<text x="${lx + 42}" y="64" font-size="22" fill="#4a4a46">${esc(text)}</text>`,
    );
  }

  if (chart.series.length > 1) {
    let lx = WIDTH - PAD.right;
    [...chart.series].reverse().forEach((s, ri) => {
      const color = COLORS[(chart.series.length - 1 - ri) % COLORS.length];
      const w = s.label.length * 12 + 36;
      lx -= w;
      parts.push(
        `<rect x="${lx}" y="48" width="18" height="18" rx="4" fill="${color}"/>`,
        `<text x="${lx + 26}" y="64" font-size="22" fill="#4a4a46">${esc(s.label)}</text>`,
      );
    });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="${FONT}"><rect width="100%" height="100%" fill="#ffffff"/>${parts.join('')}</svg>`;
}

/** La misma gráfica en PNG (para el correo: Gmail no enseña SVG). */
export function chartPng(chart) {
  const resvg = new Resvg(chartSvg(chart), {
    background: '#ffffff',
    font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' },
  });
  return resvg.render().asPng();
}
