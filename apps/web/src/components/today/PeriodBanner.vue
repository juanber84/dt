<script setup>
import { PERIOD_NAMES } from '@digitaltwin/engine';
import { periodRange } from '../../services/timeline.js';

/** Un periodo en curso (fuera de casa, enfermo) o recién acabado: qué cambia esos días. */
defineProps({ period: { type: Object, required: true } });
</script>

<template>
  <div class="card period" role="status">
    <strong>{{
      period.phase === 'during'
        ? `${PERIOD_NAMES[period.type] ?? PERIOD_NAMES.other} · ${periodRange(period).toLowerCase()}`
        : `Has vuelto hace ${period.daysSince} ${period.daysSince === 1 ? 'día' : 'días'}`
    }}</strong>
    <span class="muted">{{
      period.phase === 'during'
        ? 'El motor no aprende de estos días y el objetivo está en mantenimiento. Apunta días enteros (aunque sea a ojo) o nada.'
        : 'El peso de estos días suele venir con agua y sal: cuenta menos en la tendencia. En 3-5 días se normaliza.'
    }}</span>
  </div>
</template>

<style scoped>
.period {
  display: grid;
  gap: 2px;
  margin-bottom: 12px;
  padding: 12px 16px;
  font-size: 13px;
  border-color: color-mix(in srgb, var(--warning) 45%, var(--border));
  background: color-mix(in srgb, var(--warning) 8%, var(--surface));
}

.period strong {
  font-size: 14px;
}
</style>
