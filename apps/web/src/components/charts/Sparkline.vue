<script setup>
import { computed, ref } from 'vue';
import { useElementWidth } from '../../composables/useElementWidth.js';
import { linear, linePath } from '../../lib/scale.js';

/** Tendencia mínima: línea en tono apagado y el último valor en el color de acento. */
const props = defineProps({
  values: { type: Array, required: true },
  color: { type: String, default: 'var(--text-2)' },
  height: { type: Number, default: 28 },
});

const root = ref(null);
const width = useElementWidth(root, 120);

const geometry = computed(() => {
  const valid = props.values.filter((v) => v != null);
  if (valid.length < 2) return null;
  const x = linear([0, props.values.length - 1], [3, width.value - 5]);
  const y = linear([Math.min(...valid), Math.max(...valid)], [props.height - 4, 4]);
  // Une los huecos (días sin dato): en una tendencia mínima importa la forma
  const points = props.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
  const last = points.at(-1);
  return { d: linePath(points), last };
});
</script>

<template>
  <div ref="root" class="spark" :style="{ height: `${height}px` }" aria-hidden="true">
    <svg v-if="geometry" :width="width" :height="height">
      <path :d="geometry.d" class="line" />
      <circle :cx="geometry.last[0]" :cy="geometry.last[1]" r="3.5" :fill="color" class="end" />
    </svg>
  </div>
</template>

<style scoped>
.spark {
  width: 100%;
}

svg {
  display: block;
  overflow: visible;
}

.line {
  fill: none;
  stroke: var(--axis);
  stroke-width: 1.5;
  stroke-linejoin: round;
}

.end {
  stroke: var(--surface);
  stroke-width: 2;
}
</style>
