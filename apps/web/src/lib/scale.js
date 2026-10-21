/** Escala lineal: dominio [d0, d1] → rango [r0, r1]. */
export function linear([d0, d1], [r0, r1]) {
  const span = d1 - d0 || 1;
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

/** Ticks "redondos" que cubren [min, max]. */
export function niceTicks(min, max, count = 4, { integer = false } = {}) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw);
  // Lo que se cuenta (pasos, sesiones) no lleva marcas de 0,25: con 0 a 1 salían "1 1 1 0 0"
  const step = integer ? Math.max(1, Math.round(nice)) : nice;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return { ticks, min: start, max: end };
}

/** Rectángulo con las esquinas superiores redondeadas (barras: redondo arriba, recto en la base). */
export function topRoundedRect(x, y, width, height, radius = 4) {
  if (height <= 0) return '';
  const r = Math.min(radius, width / 2, height);
  return [
    `M${x},${y + height}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + width - r}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `V${y + height}`,
    'Z',
  ].join(' ');
}

/** Igual pero con la base arriba (barras negativas: redondo abajo). */
export function bottomRoundedRect(x, y, width, height, radius = 4) {
  if (height <= 0) return '';
  const r = Math.min(radius, width / 2, height);
  return [
    `M${x},${y}`,
    `V${y + height - r}`,
    `Q${x},${y + height} ${x + r},${y + height}`,
    `H${x + width - r}`,
    `Q${x + width},${y + height} ${x + width},${y + height - r}`,
    `V${y}`,
    'Z',
  ].join(' ');
}

/** Path de línea saltando los huecos (null). */
export function linePath(points) {
  let d = '';
  let pen = false;
  for (const point of points) {
    if (!point) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${point[0].toFixed(1)},${point[1].toFixed(1)}`;
    pen = true;
  }
  return d;
}
