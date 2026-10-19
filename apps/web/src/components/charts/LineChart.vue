<script setup>
import { computed, ref } from 'vue';
import { useElementWidth } from '../../composables/useElementWidth.js';
import { linear, niceTicks, linePath } from '../../lib/scale.js';
import ChartTooltip from './ChartTooltip.vue';

/**
 * Líneas sobre un solo eje (nunca dos escalas). Con `band` dibuja el rango normal (p. ej. tu
 * media ± desviación) como una franja tenue. Crosshair + tooltip al pasar el ratón.
 */
const props = defineProps({
  labels: { type: Array, required: true },
  series: { type: Array, required: true }, // [{ id, label, color, values, area? }]
  band: { type: Object, default: null }, // { low, high, label }
  height: { type: Number, default: 180 },
  format: { type: Function, default: (v) => String(Math.round(v)) },
  tickFormat: { type: Function, default: null },
  yDomain: { type: Array, default: null },
  zero: { type: Boolean, default: false },
  // Alto mínimo del eje (en unidades del dato): sin él, 81–82 kg ocupa toda la gráfica y una
  // oscilación normal parece un cambio enorme. Se reparte por igual arriba y abajo de los datos.
  minSpan: { type: Number, default: 0 },
  endLabel: { type: Boolean, default: true },
});

const root = ref(null);
const width = useElementWidth(root);
const hover = ref(null);

// Con varias series las etiquetas finales se pisan: entonces mandan la leyenda y el tooltip
const showEnd = computed(() => props.endLabel && props.series.length === 1);
const pad = computed(() => ({ top: 12, right: showEnd.value ? 52 : 12, bottom: 24, left: 40 }));

const scales = computed(() => {
  const values = props.series.flatMap((s) => s.values).filter((v) => v != null);
  const bandValues = props.band
    ? [props.band.low, props.band.high].flat().filter((v) => v != null)
    : [];
  const all = [...values, ...bandValues];
  // Sin ningún dato (días vacíos) el eje queda en 0–1 en vez de romperse
  let min = all.length ? Math.min(...all) : 0;
  let max = all.length ? Math.max(...all) : 1;
  if (props.minSpan && max - min < props.minSpan) {
    const mid = (min + max) / 2;
    min = mid - props.minSpan / 2;
    max = mid + props.minSpan / 2;
  }
  if (props.zero) min = Math.min(0, min);
  if (props.yDomain) [min, max] = props.yDomain;
  const nice = niceTicks(min, max, 4);
  const { top, right, bottom, left } = pad.value;
  const n = props.labels.length;
  return {
    ticks: nice.ticks,
    x: (i) => left + (n <= 1 ? 0 : (i / (n - 1)) * (width.value - left - right)),
    y: linear([nice.min, nice.max], [props.height - bottom, top]),
    step: (width.value - left - right) / Math.max(1, n - 1),
  };
});

const paths = computed(() =>
  props.series.map((s) => {
    const points = s.values.map((v, i) =>
      v == null ? null : [scales.value.x(i), scales.value.y(v)],
    );
    const line = linePath(points);
    let area = '';
    if (s.area) {
      const valid = points.filter(Boolean);
      const base = props.height - pad.value.bottom;
      if (valid.length > 1) {
        area = `${linePath(valid)}L${valid.at(-1)[0]},${base}L${valid[0][0]},${base}Z`;
      }
    }
    const lastIndex = s.values.findLastIndex((v) => v != null);
    return { ...s, line, area, lastIndex, last: points[lastIndex] };
  }),
);

const bandPath = computed(() => {
  if (!props.band) return '';
  const n = props.labels.length;
  const at = (v, i) => (Array.isArray(v) ? v[i] : v);
  // Solo donde hay rango (los días sin dato se saltan, no se pintan en 0)
  const idx = Array.from({ length: n }, (_, i) => i).filter(
    (i) => at(props.band.low, i) != null && at(props.band.high, i) != null,
  );
  if (idx.length < 2) return '';
  const top = idx.map((i) => [scales.value.x(i), scales.value.y(at(props.band.high, i))]);
  const bottom = idx
    .map((i) => [scales.value.x(i), scales.value.y(at(props.band.low, i))])
    .reverse();
  return `${linePath(top)}${linePath(bottom).replace('M', 'L')}Z`;
});

const xTicks = computed(() => {
  const n = props.labels.length;
  const count = Math.max(2, Math.min(n, Math.floor(width.value / 90)));
  const idx = new Set(
    Array.from({ length: count }, (_, k) => Math.round((k * (n - 1)) / (count - 1))),
  );
  return [...idx];
});

function onMove(event) {
  const rect = root.value.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const i = Math.round((x - pad.value.left) / scales.value.step);
  hover.value = Math.min(props.labels.length - 1, Math.max(0, i));
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
          v-for="t in scales.ticks"
          :key="t"
          :x1="pad.left"
          :x2="width - pad.right"
          :y1="scales.y(t)"
          :y2="scales.y(t)"
        />
      </g>
      <g class="y-ticks">
        <text v-for="t in scales.ticks" :key="t" :x="pad.left - 8" :y="scales.y(t)" dy="0.32em">
          {{ tick(t) }}
        </text>
      </g>
      <g class="x-ticks">
        <text
          v-for="i in xTicks"
          :key="i"
          :x="scales.x(i)"
          :y="height - 6"
          :text-anchor="i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'"
        >
          {{ labels[i] }}
        </text>
      </g>

      <path v-if="band" :d="bandPath" class="band" />

      <g v-for="s in paths" :key="s.id">
        <path v-if="s.area" :d="s.area" :fill="s.color" class="area" />
        <path :d="s.line" :stroke="s.color" class="line" />
        <circle
          v-if="s.last && hover == null"
          :cx="s.last[0]"
          :cy="s.last[1]"
          r="4"
          :fill="s.color"
          class="marker"
        />
        <text
          v-if="showEnd && s.last && hover == null"
          :x="s.last[0] + 10"
          :y="s.last[1]"
          dy="0.32em"
          class="end-label"
        >
          {{ format(s.values[s.lastIndex]) }}
        </text>
      </g>

      <g v-if="hover != null">
        <line
          class="crosshair"
          :x1="scales.x(hover)"
          :x2="scales.x(hover)"
          :y1="pad.top"
          :y2="height - pad.bottom"
        />
        <template v-for="s in paths" :key="s.id">
          <circle
            v-if="s.values[hover] != null"
            :cx="scales.x(hover)"
            :cy="scales.y(s.values[hover])"
            r="4.5"
            :fill="s.color"
            class="marker"
          />
        </template>
      </g>
    </svg>

    <ChartTooltip v-if="hover != null" :x="scales.x(hover)" :container-width="width" :top="pad.top">
      <div class="tt-title">{{ labels[hover] }}</div>
      <div v-for="s in series" :key="s.id" class="tt-row">
        <span class="dot" :style="{ background: s.color }" />
        {{ s.label }}
        <b>{{ s.values[hover] == null ? '—' : format(s.values[hover]) }}</b>
      </div>
      <div v-if="band" class="tt-row">
        <span class="dot band-dot" />
        {{ band.label ?? 'Rango normal' }}
        <b>
          {{ format(Array.isArray(band.low) ? band.low[hover] : band.low) }}–{{
            format(Array.isArray(band.high) ? band.high[hover] : band.high)
          }}
        </b>
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
  stroke-width: 1;
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

.band {
  fill: var(--text-2);
  opacity: 0.08;
}

.band-dot {
  background: color-mix(in srgb, var(--text-2) 25%, transparent);
}

.area {
  opacity: 0.1;
}

.line {
  fill: none;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.marker {
  stroke: var(--surface);
  stroke-width: 2;
}

.end-label {
  fill: var(--text);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.crosshair {
  stroke: var(--axis);
  stroke-width: 1;
}
</style>
