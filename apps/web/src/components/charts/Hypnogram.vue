<script setup>
import { computed, ref } from 'vue';
import { useElementWidth } from '../../composables/useElementWidth.js';
import { linear } from '../../lib/scale.js';
import { fmtClock, fmtDuration } from '../../lib/format.js';
import { STAGE_COLOR, STAGE_LABEL } from './colors.js';
import ChartTooltip from './ChartTooltip.vue';

/** Fases del sueño: una fila por fase, de despierto (arriba) a profundo (abajo). */
const props = defineProps({
  stages: { type: Array, required: true }, // [{ stage, start, end }]
  height: { type: Number, default: 132 },
});

const ROWS = ['awake', 'rem', 'light', 'deep'];
const root = ref(null);
const width = useElementWidth(root);
const hover = ref(null);
const pad = { left: 70, right: 4, top: 4, bottom: 22 };

const start = computed(() => props.stages[0]?.start ?? 0);
const end = computed(() => props.stages.at(-1)?.end ?? 1);
const x = computed(() => linear([start.value, end.value], [pad.left, width.value - pad.right]));
const rowH = computed(() => (props.height - pad.top - pad.bottom) / ROWS.length);

const rects = computed(() =>
  props.stages.map((s, i) => ({
    ...s,
    i,
    x: x.value(s.start),
    w: Math.max(1.5, x.value(s.end) - x.value(s.start) - 1),
    y: pad.top + ROWS.indexOf(s.stage) * rowH.value + 3,
    h: rowH.value - 6,
  })),
);

const ticks = computed(() => {
  const first = Math.ceil(start.value / 60) * 60;
  const list = [];
  // Sin pisar las etiquetas de inicio y fin
  for (let t = first; t < end.value - 50; t += 120) if (t - start.value > 50) list.push(t);
  return list;
});
</script>

<template>
  <div ref="root" class="hypno" :style="{ height: `${height}px` }">
    <svg :width="width" :height="height" role="img" aria-label="Fases del sueño">
      <g class="rows">
        <text
          v-for="(row, k) in ROWS"
          :key="row"
          :x="0"
          :y="pad.top + k * rowH + rowH / 2"
          dy="0.32em"
        >
          {{ STAGE_LABEL[row] }}
        </text>
        <line
          v-for="(row, k) in ROWS"
          :key="`l-${row}`"
          :x1="pad.left"
          :x2="width - pad.right"
          :y1="pad.top + (k + 1) * rowH"
          :y2="pad.top + (k + 1) * rowH"
        />
      </g>
      <rect
        v-for="r in rects"
        :key="r.i"
        :x="r.x"
        :y="r.y"
        :width="r.w"
        :height="r.h"
        :fill="STAGE_COLOR[r.stage]"
        rx="3"
        :class="{ dim: hover != null && hover !== r.i }"
        @pointerenter="hover = r.i"
        @pointerleave="hover = null"
      />
      <g class="axis">
        <text :x="pad.left" :y="height - 6" text-anchor="start">{{ fmtClock(start) }}</text>
        <text v-for="t in ticks" :key="t" :x="x(t)" :y="height - 6" text-anchor="middle">
          {{ fmtClock(t) }}
        </text>
        <text :x="width - pad.right" :y="height - 6" text-anchor="end">{{ fmtClock(end) }}</text>
      </g>
    </svg>
    <ChartTooltip
      v-if="hover != null"
      :x="rects[hover].x + rects[hover].w / 2"
      :container-width="width"
      :top="rects[hover].y - 8"
    >
      <div class="tt-title">
        {{ fmtClock(rects[hover].start) }} – {{ fmtClock(rects[hover].end) }}
      </div>
      <div class="tt-row">
        <span class="dot" :style="{ background: STAGE_COLOR[rects[hover].stage] }" />
        {{ STAGE_LABEL[rects[hover].stage] }}
        <b>{{ fmtDuration(rects[hover].end - rects[hover].start) }}</b>
      </div>
    </ChartTooltip>
  </div>
</template>

<style scoped>
.hypno {
  position: relative;
  width: 100%;
}

svg {
  display: block;
  overflow: visible;
}

.rows text {
  fill: var(--muted);
  font-size: 11px;
}

.rows line {
  stroke: var(--grid);
}

.axis text {
  fill: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

rect {
  transition: opacity 0.12s ease;
}

.dim {
  opacity: 0.35;
}
</style>
