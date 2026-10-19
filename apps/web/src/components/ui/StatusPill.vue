<script setup>
import { computed } from 'vue';
import { CircleCheck, CircleAlert, CircleDashed, TriangleAlert } from '@lucide/vue';

/** Estado con icono + texto (el color nunca va solo). */
const props = defineProps({
  tone: { type: String, default: 'neutral' }, // good | warning | critical | neutral
  label: { type: String, required: true },
});

const icon = computed(
  () =>
    ({ good: CircleCheck, warning: TriangleAlert, critical: CircleAlert })[props.tone] ??
    CircleDashed,
);
</script>

<template>
  <span class="pill" :class="tone">
    <component :is="icon" class="icon icon-sm" aria-hidden="true" />
    {{ label }}
  </span>
</template>

<style scoped>
.pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--text-2);
  background: var(--surface-2);
}

.pill .icon {
  width: 13px;
  height: 13px;
}

.good {
  color: var(--good-text);
  background: color-mix(in srgb, var(--good) 12%, transparent);
}

.warning {
  color: var(--warning-text);
  background: color-mix(in srgb, var(--warning) 14%, transparent);
}

.critical {
  color: var(--critical-text);
  background: color-mix(in srgb, var(--critical) 12%, transparent);
}
</style>
