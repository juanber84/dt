<script setup>
import { computed } from 'vue';

/**
 * Anillo de puntuación (recuperación, sueño...). El valor va en el centro, en tinta de texto.
 * Sin valor (null): anillo vacío y una raya.
 */
const props = defineProps({
  value: { type: Number, default: null },
  max: { type: Number, default: 100 },
  color: { type: String, required: true },
  size: { type: Number, default: 116 },
  stroke: { type: Number, default: 9 },
  label: { type: String, default: '' },
  unit: { type: String, default: '' },
  display: { type: String, default: null },
});

const r = computed(() => (props.size - props.stroke) / 2);
const circumference = computed(() => 2 * Math.PI * r.value);
const offset = computed(
  () => circumference.value * (1 - Math.min(1, Math.max(0, (props.value ?? 0) / props.max))),
);
const text = computed(() => props.display ?? (props.value == null ? '—' : props.value));
</script>

<template>
  <div class="ring" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg
      :width="size"
      :height="size"
      :viewBox="`0 0 ${size} ${size}`"
      role="img"
      :aria-label="`${label}: ${value == null ? 'sin datos' : `${text}${unit}`}`"
    >
      <circle class="track" :cx="size / 2" :cy="size / 2" :r="r" :stroke-width="stroke" />
      <circle
        class="arc"
        :cx="size / 2"
        :cy="size / 2"
        :r="r"
        :stroke="color"
        :stroke-width="stroke"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="offset"
        :transform="`rotate(-90 ${size / 2} ${size / 2})`"
      />
    </svg>
    <div class="center">
      <span class="value"
        >{{ text }}<small v-if="unit && value != null">{{ unit }}</small></span
      >
    </div>
  </div>
</template>

<style scoped>
.ring {
  position: relative;
  flex: none;
}

.track {
  fill: none;
  stroke: var(--grid);
}

.arc {
  fill: none;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.center {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}

.value {
  font-size: 30px;
  font-weight: 650;
  letter-spacing: -0.03em;
}

.value small {
  font-size: 14px;
  font-weight: 500;
  color: var(--muted);
  margin-left: 1px;
}
</style>
