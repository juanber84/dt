<script setup>
import { ref } from 'vue';
import { Table2, ChartLine } from '@lucide/vue';

/**
 * Marco de una gráfica: título, cifra principal, leyenda y la vista de tabla (accesible y para
 * ver los números exactos).
 */
defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  table: { type: Object, default: null }, // { columns: [..], rows: [[..]] }
});

const showTable = ref(false);
</script>

<template>
  <section class="card chart-card">
    <header>
      <div class="titles">
        <h2>{{ title }}</h2>
        <p v-if="subtitle" class="muted">{{ subtitle }}</p>
      </div>
      <slot name="headline" />
      <button
        v-if="table"
        class="btn btn-ghost btn-sm btn-icon"
        :title="showTable ? 'Ver gráfica' : 'Ver tabla'"
        :aria-label="showTable ? 'Ver gráfica' : 'Ver tabla'"
        @click="showTable = !showTable"
      >
        <ChartLine v-if="showTable" class="icon icon-sm" />
        <Table2 v-else class="icon icon-sm" />
      </button>
    </header>
    <div v-if="$slots.legend && !showTable" class="legend"><slot name="legend" /></div>
    <div v-if="showTable && table" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th v-for="c in table.columns" :key="c">{{ c }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in table.rows" :key="i">
            <td v-for="(cell, k) in row" :key="k">{{ cell }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <slot v-else />
  </section>
</template>

<style scoped>
.chart-card {
  padding: 18px 20px 14px;
  min-width: 0;
}

header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 14px;
}

.titles {
  flex: 1;
  min-width: 0;
}

.titles p {
  font-size: 12px;
  margin-top: 2px;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin: -4px 0 10px;
  font-size: 12px;
  color: var(--text-2);
}

.legend :deep(span) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.table-wrap {
  max-height: 260px;
  overflow: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

th,
td {
  padding: 6px 8px;
  text-align: right;
  border-bottom: 1px solid var(--grid);
}

th:first-child,
td:first-child {
  text-align: left;
}

th {
  position: sticky;
  top: 0;
  background: var(--surface);
  color: var(--muted);
  font-weight: 500;
}
</style>
