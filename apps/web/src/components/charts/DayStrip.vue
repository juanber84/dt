<script setup>
import { computed, ref } from 'vue';
import { useElementWidth } from '../../composables/useElementWidth.js';
import { linear, linePath } from '../../lib/scale.js';
import { fmtClock, fmtDuration } from '../../lib/format.js';
import { CATEGORY_COLOR, STAGE_COLOR } from './colors.js';
import ChartTooltip from './ChartTooltip.vue';

/**
 * El día en una franja de 24 h: frecuencia cardiaca arriba y, debajo, los eventos (sueño por
 * fases, entrenos, comidas...). Pasar el ratón muestra la hora, las ppm y qué estaba pasando.
 */
const props = defineProps({
  hr: { type: Array, required: true }, // [{ t, bpm }]
  events: { type: Array, required: true },
  until: { type: Number, default: 1440 }, // hoy: minuto actual
  selectedId: { type: String, default: null },
});
const emit = defineEmits(['select']);

const root = ref(null);
const width = useElementWidth(root);
const hover = ref(null);

const H = { hrTop: 22, hrBottom: 92, laneTop: 104, laneBottom: 128, axis: 148, total: 156 };
const pad = { left: 8, right: 8 };

const x = computed(() => linear([0, 1440], [pad.left, width.value - pad.right]));
const hrRange = computed(() => {
  const values = props.hr.map((p) => p.bpm);
  return [Math.min(...values, 50) - 4, Math.max(...values, 120) + 6];
});
const y = computed(() => linear(hrRange.value, [H.hrBottom, H.hrTop]));

const hrLine = computed(() => linePath(props.hr.map((p) => [x.value(p.t), y.value(p.bpm)])));
const hrArea = computed(() => {
  if (props.hr.length < 2) return '';
  const last = props.hr.at(-1);
  return `${hrLine.value}L${x.value(last.t)},${H.hrBottom}L${x.value(props.hr[0].t)},${H.hrBottom}Z`;
});

const clampT = (t) => Math.max(0, Math.min(1440, t));

const blocks = computed(() =>
  props.events
    .filter((e) => e.end != null)
    .flatMap((e) => {
      if (e.category === 'sleep' && e.sleep) {
        return e.sleep.stages
          .filter((s) => s.end > 0)
          .map((s, k) => ({
            key: `${e.id}-${k}`,
            event: e,
            x: x.value(clampT(s.start)),
            w: Math.max(1, x.value(clampT(s.end)) - x.value(clampT(s.start)) - 1),
            color: STAGE_COLOR[s.stage],
          }));
      }
      return [
        {
          key: e.id,
          event: e,
          x: x.value(clampT(e.start)),
          w: Math.max(3, x.value(clampT(e.end)) - x.value(clampT(e.start))),
          color: CATEGORY_COLOR[e.category] ?? 'var(--text-2)',
        },
      ];
    }),
);

const points = computed(() =>
  props.events
    .filter((e) => e.end == null)
    .map((e) => ({
      event: e,
      cx: x.value(e.start),
      color: CATEGORY_COLOR[e.category] ?? 'var(--text-2)',
    })),
);

// Cada 3 h; en pantallas estrechas cada 6 h para que no se pisen
const hours = computed(() =>
  width.value < 520 ? [0, 6, 12, 18, 24] : [0, 3, 6, 9, 12, 15, 18, 21, 24],
);

function eventsAt(t) {
  return props.events.filter((e) =>
    e.end != null ? t >= e.start && t <= e.end : Math.abs(t - e.start) <= 15,
  );
}

function onMove(event) {
  const rect = root.value.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const t = Math.round(((px - pad.left) / (width.value - pad.left - pad.right)) * 1440);
  if (t < 0 || t > 1440) return (hover.value = null);
  const near = props.hr.reduce(
    (best, p) => (Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best),
    props.hr[0] ?? { t, bpm: null },
  );
  hover.value = {
    t,
    px,
    bpm: t <= props.until && Math.abs(near.t - t) <= 10 ? near.bpm : null,
    events: eventsAt(t),
  };
}

function onClick() {
  const target = hover.value?.events.at(-1);
  if (target) emit('select', target);
}
</script>

<template>
  <div
    ref="root"
    class="strip"
    :style="{ height: `${H.total}px` }"
    :class="{ clickable: hover?.events.length }"
  >
    <svg
      :width="width"
      :height="H.total"
      role="img"
      aria-label="Frecuencia cardiaca y eventos del día"
      @pointermove="onMove"
      @pointerleave="hover = null"
      @click="onClick"
    >
      <g class="hours">
        <line
          v-for="h in hours"
          :key="h"
          :x1="x(h * 60)"
          :x2="x(h * 60)"
          :y1="H.hrTop - 6"
          :y2="H.laneBottom"
        />
      </g>

      <rect
        v-if="until < 1440"
        class="future"
        :x="x(until)"
        :y="H.hrTop - 6"
        :width="x(1440) - x(until)"
        :height="H.laneBottom - H.hrTop + 6"
      />

      <path :d="hrArea" class="hr-area" />
      <path :d="hrLine" class="hr-line" />

      <rect
        class="lane"
        :x="x(0)"
        :y="H.laneTop"
        :width="x(1440) - x(0)"
        :height="H.laneBottom - H.laneTop"
        rx="6"
      />
      <rect
        v-for="b in blocks"
        :key="b.key"
        :x="b.x"
        :y="H.laneTop"
        :width="b.w"
        :height="H.laneBottom - H.laneTop"
        :fill="b.color"
        rx="3"
        :class="{ dim: selectedId && b.event.id !== selectedId }"
      />
      <circle
        v-for="p in points"
        :key="p.event.id"
        :cx="p.cx"
        :cy="(H.laneTop + H.laneBottom) / 2"
        r="5"
        :fill="p.color"
        class="point"
        :class="{ dim: selectedId && p.event.id !== selectedId }"
      />

      <g v-if="until < 1440" class="now">
        <line :x1="x(until)" :x2="x(until)" :y1="H.hrTop - 10" :y2="H.laneBottom + 4" />
        <text :x="x(until)" :y="H.hrTop - 13">Ahora</text>
      </g>

      <g class="axis">
        <text
          v-for="h in hours"
          :key="h"
          :x="x(h * 60)"
          :y="H.axis"
          :text-anchor="h === 0 ? 'start' : h === 24 ? 'end' : 'middle'"
        >
          {{ String(h % 24).padStart(2, '0') }}:00
        </text>
      </g>

      <g v-if="hover">
        <line
          class="crosshair"
          :x1="hover.px"
          :x2="hover.px"
          :y1="H.hrTop - 6"
          :y2="H.laneBottom"
        />
        <circle v-if="hover.bpm" :cx="hover.px" :cy="y(hover.bpm)" r="4" class="hr-marker" />
      </g>
    </svg>

    <ChartTooltip v-if="hover" :x="hover.px" :container-width="width" :top="H.hrTop">
      <div class="tt-title">{{ fmtClock(hover.t) }}</div>
      <div v-if="hover.bpm" class="tt-row">
        <span class="dot" style="background: var(--hr-line)" />
        Frecuencia cardiaca <b>{{ hover.bpm }} ppm</b>
      </div>
      <div v-for="e in hover.events" :key="e.id" class="tt-row">
        <span class="dot" :style="{ background: CATEGORY_COLOR[e.category] ?? 'var(--text-2)' }" />
        {{ e.title }}
        <b>{{ e.end != null ? fmtDuration(e.end - e.start) : fmtClock(e.start) }}</b>
      </div>
      <div v-if="!hover.bpm && !hover.events.length" class="tt-row">Sin datos</div>
    </ChartTooltip>
  </div>
</template>

<style scoped>
.strip {
  position: relative;
  width: 100%;
}

.strip.clickable {
  cursor: pointer;
}

svg {
  display: block;
  overflow: visible;
  touch-action: pan-y;
}

.hours line {
  stroke: var(--grid);
}

.future {
  fill: var(--page);
  opacity: 0.6;
}

.hr-line {
  fill: none;
  stroke: var(--hr-line);
  stroke-width: 1.5;
  stroke-linejoin: round;
}

.hr-area {
  fill: var(--hr-line);
  opacity: 0.07;
}

.lane {
  fill: var(--surface-2);
}

.point {
  stroke: var(--surface);
  stroke-width: 2;
}

.dim {
  opacity: 0.35;
}

.now line {
  stroke: var(--text);
  stroke-width: 1;
}

.now text {
  fill: var(--text);
  font-size: 11px;
  font-weight: 600;
  text-anchor: middle;
}

.axis text {
  fill: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.crosshair {
  stroke: var(--axis);
}

.hr-marker {
  fill: var(--hr-line);
  stroke: var(--surface);
  stroke-width: 2;
}
</style>
