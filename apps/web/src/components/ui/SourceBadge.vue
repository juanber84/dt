<script setup>
import { computed } from 'vue';
import { SOURCES } from '../../data/sources.js';

const props = defineProps({
  source: { type: String, required: true },
  size: { type: Number, default: 20 },
});
const info = computed(() => SOURCES[props.source] ?? { name: props.source, monogram: '?' });
</script>

<template>
  <span
    class="badge"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.45)}px` }"
    :title="info.name"
    :aria-label="info.name"
  >
    {{ info.monogram }}
  </span>
</template>

<style scoped>
.badge {
  display: inline-grid;
  place-items: center;
  flex: none;
  border-radius: 6px;
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  color: var(--text-2);
  font-weight: 650;
  letter-spacing: -0.02em;
}
</style>
