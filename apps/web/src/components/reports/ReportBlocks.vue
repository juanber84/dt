<script setup>
import CoachChart from '../coach/CoachChart.vue';
import Meter from '../ui/Meter.vue';
import { formatStat } from '../../services/reports.js';

/**
 * Los bloques de un informe (los mismos que van en el correo): texto, cifras, tablas, gráficas y
 * avisos. Las gráficas son las del coach, aquí ya interactivas.
 */
defineProps({ blocks: { type: Array, required: true } });

const paragraphs = (text) => text.split(/\n\s*\n/).map((p) => p.trim());
const cell = (v) => (v == null || v === '' ? '—' : v);
</script>

<template>
  <div class="blocks">
    <template v-for="(block, i) in blocks" :key="i">
      <h2 v-if="block.type === 'heading'" class="block-title">{{ block.text }}</h2>

      <div v-else-if="block.type === 'text'" class="card card-pad text">
        <p v-for="(p, j) in paragraphs(block.text)" :key="j">{{ p }}</p>
      </div>

      <section v-else-if="block.type === 'stats'">
        <h2 v-if="block.title" class="block-title">{{ block.title }}</h2>
        <div class="stats">
          <div v-for="item in block.items" :key="item.label" class="card stat">
            <span class="muted label">{{ item.label }}</span>
            <strong :class="{ muted: item.value == null }">{{ formatStat(item) }}</strong>
            <Meter
              v-if="item.value != null && item.target"
              :value="item.value"
              :max="item.target"
              :color="item.value > item.target * 1.1 ? 'var(--warning)' : 'var(--nutrition)'"
            />
            <span v-if="item.note" class="muted note">{{ item.note }}</span>
          </div>
        </div>
      </section>

      <section v-else-if="block.type === 'table'">
        <h2 v-if="block.title" class="block-title">{{ block.title }}</h2>
        <div class="card table-wrap">
          <table>
            <thead>
              <tr>
                <th v-for="c in block.columns" :key="c">{{ c }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, r) in block.rows" :key="r">
                <td v-for="(v, c) in row" :key="c">{{ cell(v) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div v-else-if="block.type === 'chart'" class="card card-pad">
        <CoachChart :chart="block" />
      </div>

      <div v-else-if="block.type === 'callout'" class="callout" :class="block.tone">
        {{ block.text }}
      </div>
    </template>
  </div>
</template>

<style scoped>
.blocks {
  display: grid;
  gap: 12px;
}

.block-title {
  margin: 12px 0 0;
  font-size: 15px;
}

.text p + p {
  margin-top: 10px;
}

.text p {
  font-size: 15px;
  line-height: 1.55;
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
  margin-top: 8px;
}

.stat {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
}

.stat .label,
.stat .note {
  font-size: 12px;
}

.stat strong {
  font-size: 17px;
  font-variant-numeric: tabular-nums;
}

.stat strong.muted {
  font-weight: 400;
}

.table-wrap {
  margin-top: 8px;
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th {
  padding: 8px 12px;
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-variant-numeric: tabular-nums;
}

tr:last-child td {
  border-bottom: 0;
}

.callout {
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  white-space: pre-line;
  background: var(--surface-2);
  border: 1px solid var(--border);
}

.callout.warning {
  border-color: color-mix(in srgb, var(--warning) 45%, var(--border));
  background: color-mix(in srgb, var(--warning) 10%, var(--surface));
}
</style>
