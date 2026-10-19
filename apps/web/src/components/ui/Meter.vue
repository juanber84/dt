<script setup>
import { computed } from 'vue';

/** Barra de progreso hacia un objetivo. La pista es el mismo color, más claro. */
const props = defineProps({
  value: { type: Number, required: true },
  max: { type: Number, required: true },
  color: { type: String, default: 'var(--text)' },
  height: { type: Number, default: 6 },
});
const pct = computed(() => Math.min(100, Math.max(0, (props.value / props.max) * 100)));
</script>

<template>
  <div
    class="meter"
    :style="{ height: `${height}px`, '--c': color }"
    role="meter"
    :aria-valuenow="value"
    :aria-valuemax="max"
    aria-valuemin="0"
  >
    <div class="fill" :style="{ width: `${pct}%` }" />
  </div>
</template>

<style scoped>
.meter {
  width: 100%;
  border-radius: 999px;
  background: color-mix(in srgb, var(--c) 16%, transparent);
  overflow: hidden;
}

.fill {
  height: 100%;
  border-radius: 999px;
  background: var(--c);
  transition: width 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
}
</style>
