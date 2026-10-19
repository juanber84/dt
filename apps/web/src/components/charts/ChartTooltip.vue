<script setup>
import { computed } from 'vue';

const props = defineProps({
  x: { type: Number, required: true },
  containerWidth: { type: Number, required: true },
  top: { type: Number, default: 0 },
});

// Se coloca a la derecha del cursor y se da la vuelta cerca del borde
const style = computed(() => {
  const flip = props.x > props.containerWidth - 200;
  return {
    left: `${props.x}px`,
    top: `${props.top}px`,
    transform: flip ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
  };
});
</script>

<template>
  <div class="tooltip" :style="style" role="status">
    <slot />
  </div>
</template>

<style scoped>
.tooltip {
  position: absolute;
  z-index: 5;
  min-width: 140px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow);
  font-size: 12px;
  pointer-events: none;
  white-space: nowrap;
}

.tooltip :deep(.tt-title) {
  color: var(--muted);
  margin-bottom: 4px;
}

.tooltip :deep(.tt-row) {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-2);
}

.tooltip :deep(.tt-row b) {
  margin-left: auto;
  padding-left: 12px;
  color: var(--text);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
