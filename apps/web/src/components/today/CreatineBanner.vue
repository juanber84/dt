<script setup>
import { creatinePhrase } from '@digitaltwin/engine';

/**
 * Creatina empezada o dejada hace menos de 4 semanas (aviso del motor): el peso que sube o baja
 * es agua. Solo avisa; las cifras del motor no cambian.
 */
defineProps({ notice: { type: Object, required: true } });
</script>

<template>
  <div class="card creatine" role="status">
    <strong>{{
      notice.phase === 'starting' ? 'Creatina: el peso sube agua' : 'Creatina: el peso baja agua'
    }}</strong>
    <span class="muted">{{ creatinePhrase(notice) }}</span>
  </div>
</template>

<style scoped>
.creatine {
  display: grid;
  gap: 2px;
  margin-bottom: 12px;
  padding: 12px 16px;
  font-size: 13px;
  border-color: color-mix(in srgb, var(--nutrition) 45%, var(--border));
  background: color-mix(in srgb, var(--nutrition) 8%, var(--surface));
}

.creatine strong {
  font-size: 14px;
}
</style>
