<script setup>
import { computed, ref } from 'vue';
import { useElementWidth } from '../../composables/useElementWidth.js';
import { linear, niceTicks, topRoundedRect, bottomRoundedRect } from '../../lib/scale.js';
import ChartTooltip from './ChartTooltip.vue';

/**
 * Columnas (apiladas si hay varias series) desde una sola base. Admite negativos (columnas
 * divergentes con `colorFor`) y una línea de objetivo.
 */
const props = defineProps({
  labels: { type: Array, required: true },
  series: { type: Array, required: true }, // [{ id, label, color, values }]
  height: { type: Number, default: 160 },
  format: { type: Function, default: (v) => String(Math.round(v)) },
  tickFormat: { type: Function, default: null },
  target: { type: Number, default: null },
  targetLabel: { type: String, default: 'Objetivo' },
  colorFor: { type: Function, default: null }, // (valor) => color, solo con una serie
  tooltipLabels: { type: Array, default: null },
  xTickEvery: { type: Number, default: 0 },
  yTicks: { type: Array, default: null }, // marcas fijas (p. ej. cada 2 h)
});

const root = ref(null);
const width = useElementWidth(root);
const hover = ref(null);
const pad = { top: 12, right: 8, bottom: 24, left: 40 };

const geometry = computed(() => {
  const n = props.labels.length;
  const totals = props.labels.map((_, i) =>
    props.series.reduce((acc, s) => acc + (s.values[i] ?? 0), 0),
  );
  const min = Math.min(0, ...totals);
  const max = Math.max(...totals, props.target ?? 0, 1);
  const nice = props.yTicks
    ? { ticks: props.yTicks, min: props.yTicks[0], max: props.yTicks.at(-1) }
    : niceTicks(min, max, 4);
  const y = linear([nice.min, nice.max], [props.height - pad.bottom, pad.top]);
  const band = (width.value - pad.left - pad.right) / n;
  const barWidth = Math.max(2, Math.min(24, band * 0.62));
  const bars = props.labels.map((_, i) => {
    const x = pad.left + band * i + (band - barWidth) / 2;
    let acc = 0;
    const visible = props.series.filter((s) => (s.values[i] ?? 0) !== 0);
    const segments = visible.map((s, k) => {
      const value = s.values[i] ?? 0;
      const from = acc;
      acc += value;
      const top = y(Math.max(from, acc));
      const bottom = y(Math.min(from, acc));
      // 2px de hueco entre segmentos apilados; solo el de arriba lleva las esquinas redondas
      const gap = k > 0 ? 2 : 0;
      const h = Math.max(0, bottom - top - gap);
      const isTop = k === visible.length - 1;
      const color = props.colorFor ? props.colorFor(value) : s.color;
      const d =
        value < 0
          ? bottomRoundedRect(x, top, barWidth, h, 4)
          : isTop
            ? topRoundedRect(x, top, barWidth, h, 4)
            : `M${x},${top}h${barWidth}v${h}h${-barWidth}Z`;
      return { id: s.id, d, color };
    });
    return { i, x, center: x + barWidth / 2, segments, total: totals[i] };
  });
  return { ticks: nice.ticks, y, band, bars };
});

const xTicks = computed(() => {
  const n = props.labels.length;
  const every =
    props.xTickEvery || Math.max(1, Math.ceil(n / Math.max(2, Math.floor(width.value / 56))));
  // La última siempre; la anterior se quita si quedaría pegada
  return props.labels
    .map((label, i) => ({ label, i }))
    .filter(({ i }) => i === n - 1 || (i % every === 0 && n - 1 - i >= every * 0.75));
});

function onMove(event) {
  const rect = root.value.getBoundingClientRect();
  const i = Math.floor((event.clientX - rect.left - pad.left) / geometry.value.band);
  hover.value = i >= 0 && i < props.labels.length ? i : null;
}

const tick = (v) => (props.tickFormat ?? props.format)(v);
</script>

<template>
  <div ref="root" class="chart" :style="{ height: `${height}px` }">
    <svg
      :width="width"
      :height="height"
      role="img"
      :aria-label="series.map((s) => s.label).join(', ')"
      @pointermove="onMove"
      @pointerleave="hover = null"
    >
      <g class="grid">
        <line
          v-for="t in geometry.ticks"
          :key="t"
          :x1="pad.left"
          :x2="width - pad.right"
          :y1="geometry.y(t)"
          :y2="geometry.y(t)"
          :class="{ base: t === 0 }"
        />
      </g>
      <g class="y-ticks">
        <text v-for="t in geometry.ticks" :key="t" :x="pad.left - 8" :y="geometry.y(t)" dy="0.32em">
          {{ tick(t) }}
        </text>
      </g>
      <g class="x-ticks">
        <text v-for="t in xTicks" :key="t.i" :x="geometry.bars[t.i].center" :y="height - 6">
          {{ t.label }}
        </text>
      </g>
      <rect
        v-if="hover != null"
        class="hover-band"
        :x="pad.left + geometry.band * hover"
        :y="pad.top"
        :width="geometry.band"
        :height="height - pad.top - pad.bottom"
        rx="4"
      />
      <g v-for="bar in geometry.bars" :key="bar.i">
        <path v-for="seg in bar.segments" :key="seg.id" :d="seg.d" :fill="seg.color" />
      </g>
      <g v-if="target != null" class="target">
        <line
          :x1="pad.left"
          :x2="width - pad.right"
          :y1="geometry.y(target)"
          :y2="geometry.y(target)"
        />
        <text :x="width - pad.right" :y="geometry.y(target) - 5">
          {{ targetLabel }} {{ format(target) }}
        </text>
      </g>
    </svg>
    <ChartTooltip
      v-if="hover != null"
      :x="geometry.bars[hover].center"
      :container-width="width"
      :top="pad.top"
    >
      <div class="tt-title">{{ (tooltipLabels ?? labels)[hover] }}</div>
      <div v-for="s in series" :key="s.id" class="tt-row">
        <span
          class="dot"
          :style="{ background: colorFor ? colorFor(s.values[hover] ?? 0) : s.color }"
        />
        {{ s.label }}
        <b>{{ s.values[hover] == null ? '—' : format(s.values[hover]) }}</b>
      </div>
      <div v-if="series.length > 1" class="tt-row">
        Total <b>{{ format(geometry.bars[hover].total) }}</b>
      </div>
    </ChartTooltip>
  </div>
</template>

<style scoped>
.chart {
  position: relative;
  width: 100%;
}

svg {
  display: block;
  overflow: visible;
  touch-action: pan-y;
}

.grid line {
  stroke: var(--grid);
}

.grid line.base {
  stroke: var(--axis);
}

.y-ticks text,
.x-ticks text {
  fill: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.y-ticks text {
  text-anchor: end;
}

.x-ticks text {
  text-anchor: middle;
}

.hover-band {
  fill: var(--text);
  opacity: 0.04;
}

.target line {
  stroke: var(--text-2);
  stroke-width: 1;
}

.target text {
  fill: var(--text-2);
  font-size: 11px;
  text-anchor: end;
}
</style>
