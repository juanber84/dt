<script setup>
import { computed } from 'vue';
import LineChart from '../charts/LineChart.vue';
import BarChart from '../charts/BarChart.vue';
import { chartGroups, chartLabels } from '../../services/coach.js';

/** Una gráfica que enseña el coach (show_chart): una por unidad, una debajo de otra. */
const props = defineProps({
  chart: { type: Object, required: true },
});

const labels = computed(() => chartLabels(props.chart));
const groups = computed(() => chartGroups(props.chart));

const formatter = (group) => {
  const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: group.decimals });
  return (v) => (v == null ? '—' : `${nf.format(v)}${group.unit ? ` ${group.unit}` : ''}`);
};
const tickFormatter = (group) => {
  const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: group.decimals });
  return (v) => nf.format(v);
};
</script>

<template>
  <figure class="coach-chart">
    <figcaption>{{ chart.title }}</figcaption>
    <div v-for="g in groups" :key="g.key" class="group">
      <div class="head">
        <span class="name"
          >{{ g.title }}<span v-if="g.unit" class="unit"> · {{ g.unit }}</span></span
        >
        <span v-if="g.legend.length" class="legend">
          <span v-for="l in g.legend" :key="l.label">
            <span class="dot" :style="{ background: l.color }" />{{ l.label }}
          </span>
        </span>
      </div>
      <BarChart
        v-if="g.kind === 'bar'"
        :labels="labels"
        :series="g.series"
        :height="150"
        :format="formatter(g)"
        :tick-format="tickFormatter(g)"
        :x-tick-every="Math.ceil(labels.length / 6)"
      />
      <LineChart
        v-else
        :labels="labels"
        :series="g.series"
        :height="160"
        :format="formatter(g)"
        :tick-format="tickFormatter(g)"
        :min-span="g.minSpan"
      />
    </div>
  </figure>
</template>

<style scoped>
.coach-chart {
  margin: 4px 0 12px;
  padding: 12px 14px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  min-width: 0;
}

figcaption {
  font-weight: 600;
  margin-bottom: 8px;
}

.group + .group {
  margin-top: 12px;
}

.head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
  margin-bottom: 4px;
  font-size: 12px;
}

.name {
  color: var(--text-2);
}

.unit {
  color: var(--muted);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  color: var(--text-2);
}

.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 5px;
  vertical-align: 0;
}
</style>
