<script setup>
import Sparkline from '../charts/Sparkline.vue';
import Delta from '../ui/Delta.vue';

/** Constante vital: valor, variación frente a tu media y tendencia de las últimas semanas. */
defineProps({
  label: { type: String, required: true },
  value: { type: String, required: true },
  unit: { type: String, default: '' },
  delta: { type: Number, default: null },
  deltaDigits: { type: Number, default: 0 },
  deltaUnit: { type: String, default: '' },
  goodWhen: { type: String, default: 'up' },
  trend: { type: Array, default: () => [] },
});
</script>

<template>
  <div class="card vital">
    <span class="section-label">{{ label }}</span>
    <div class="value-row">
      <span class="value">{{ value }}</span>
      <span v-if="unit" class="unit">{{ unit }}</span>
    </div>
    <Delta
      :value="delta"
      :digits="deltaDigits"
      :unit="deltaUnit"
      :good-when="goodWhen"
      versus="vs. tu media"
    />
    <Sparkline :values="trend" color="var(--text)" />
  </div>
</template>

<style scoped>
.vital {
  display: grid;
  gap: 4px;
  padding: 14px 16px 12px;
  min-width: 0;
}

.value-row {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.value {
  font-size: 24px;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.unit {
  color: var(--muted);
  font-size: 12px;
}
</style>
