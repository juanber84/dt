<script setup>
import { computed } from 'vue';
import { gaugeGeometry } from '../../services/clinical.js';

/** Barra con el rango de referencia sombreado y un punto donde cae el valor. */
const props = defineProps({
  value: { type: Number, default: null },
  min: { type: Number, default: null },
  max: { type: Number, default: null },
  flagged: { type: Boolean, default: false },
  label: { type: String, default: '' },
});
const g = computed(() => gaugeGeometry(props.value, props.min, props.max));
</script>

<template>
  <div v-if="g" class="gauge" :title="label" role="img" :aria-label="label">
    <span class="band" :style="{ left: `${g.band[0]}%`, width: `${g.band[1] - g.band[0]}%` }" />
    <span class="marker" :class="{ flagged }" :style="{ left: `${g.marker}%` }" />
  </div>
</template>

<style scoped>
.gauge {
  position: relative;
  height: 10px;
  margin: 0 5px;
}

.gauge::before {
  content: '';
  position: absolute;
  inset: 3px 0;
  border-radius: 2px;
  background: var(--grid);
}

.band {
  position: absolute;
  top: 3px;
  bottom: 3px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--text) 22%, var(--grid));
}

.marker {
  position: absolute;
  top: 0;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  border-radius: 50%;
  background: var(--text);
  box-shadow: 0 0 0 2px var(--surface);
}

.marker.flagged {
  background: var(--critical);
}
</style>
