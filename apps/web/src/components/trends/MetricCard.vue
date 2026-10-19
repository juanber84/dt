<script setup>
import ChartCard from '../ui/ChartCard.vue';
import Delta from '../ui/Delta.vue';

/** Tarjeta de tendencia: media del periodo y variación frente al periodo anterior. */
defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  value: { type: String, required: true },
  unit: { type: String, default: '' },
  delta: { type: Number, default: null },
  deltaDigits: { type: Number, default: 0 },
  deltaUnit: { type: String, default: '' },
  goodWhen: { type: String, default: 'up' },
  table: { type: Object, default: null },
});
</script>

<template>
  <ChartCard :title="title" :subtitle="subtitle" :table="table">
    <template #headline>
      <div class="headline">
        <span class="value"
          >{{ value }}<small v-if="unit"> {{ unit }}</small></span
        >
        <Delta
          :value="delta"
          :digits="deltaDigits"
          :unit="deltaUnit"
          :good-when="goodWhen"
          versus="vs. periodo anterior"
        />
      </div>
    </template>
    <template v-if="$slots.legend" #legend><slot name="legend" /></template>
    <slot />
  </ChartCard>
</template>

<style scoped>
.headline {
  display: grid;
  justify-items: end;
  gap: 2px;
}

.value {
  font-size: 20px;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.value small {
  font-size: 12px;
  font-weight: 400;
  color: var(--muted);
}
</style>
