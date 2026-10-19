<script setup>
import { computed } from 'vue';
import { ArrowUp, ArrowDown } from '@lucide/vue';
import { fmtSigned } from '../../lib/format.js';

/** Variación con signo. El color dice si es bueno o malo (y siempre lleva flecha y texto). */
const props = defineProps({
  value: { type: Number, default: null },
  digits: { type: Number, default: 0 },
  unit: { type: String, default: '' },
  goodWhen: { type: String, default: 'up' }, // up | down | none
  versus: { type: String, default: '' },
});

const tone = computed(() => {
  if (
    props.value == null ||
    props.goodWhen === 'none' ||
    Math.abs(props.value) < 10 ** -props.digits / 2
  )
    return 'neutral';
  const up = props.value > 0;
  return (props.goodWhen === 'up') === up ? 'good' : 'bad';
});
</script>

<template>
  <span v-if="value != null" class="delta" :class="tone">
    <ArrowUp v-if="value > 0" class="icon icon-sm" aria-hidden="true" />
    <ArrowDown v-else-if="value < 0" class="icon icon-sm" aria-hidden="true" />
    <span class="num">{{ fmtSigned(value, digits) }}{{ unit }}</span>
    <span v-if="versus" class="versus">{{ versus }}</span>
  </span>
</template>

<style scoped>
.delta {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-2);
}

.delta .icon {
  width: 12px;
  height: 12px;
  stroke-width: 2.25;
}

.good {
  color: var(--good-text);
}

.bad {
  color: var(--critical-text);
}

.versus {
  margin-left: 4px;
  color: var(--muted);
  font-weight: 400;
}
</style>
