<script setup>
import { computed, ref } from 'vue';
import { iconFor } from '../../lib/icons.js';
import { fmtClock, fmtDec, fmtInt } from '../../lib/format.js';
import { CATEGORY_COLOR } from '../charts/colors.js';
import SourceBadge from '../ui/SourceBadge.vue';

const props = defineProps({
  events: { type: Array, required: true },
  selectedId: { type: String, default: null },
});
const emit = defineEmits(['select']);

const FILTERS = [
  { id: 'all', label: 'Todo' },
  { id: 'sleep', label: 'Sueño' },
  { id: 'activity', label: 'Actividad' },
  { id: 'nutrition', label: 'Nutrición' },
  { id: 'body', label: 'Cuerpo' },
  { id: 'hydration', label: 'Hidratación' },
  { id: 'note', label: 'Notas' },
  { id: 'clinical', label: 'Clínica' },
];

const filter = ref('all');
const counts = computed(() =>
  props.events.reduce((acc, e) => ({ ...acc, [e.category]: (acc[e.category] ?? 0) + 1 }), {}),
);
const available = computed(() => FILTERS.filter((f) => f.id === 'all' || counts.value[f.id]));
const visible = computed(() =>
  filter.value === 'all' ? props.events : props.events.filter((e) => e.category === filter.value),
);

const metricText = (m) =>
  `${m.digits ? fmtDec(m.value, m.digits) : fmtInt(m.value)}${m.unit ? ` ${m.unit}` : ''}`;
const sourcesOf = (e) => [...new Set(e.sources.map((s) => s.source))];
</script>

<template>
  <section class="timeline">
    <div class="filters" role="tablist" aria-label="Filtrar eventos">
      <button
        v-for="f in available"
        :key="f.id"
        role="tab"
        :aria-selected="filter === f.id"
        :class="{ active: filter === f.id }"
        @click="filter = f.id"
      >
        {{ f.label }}
        <span v-if="f.id !== 'all'" class="count">{{ counts[f.id] }}</span>
      </button>
    </div>

    <p v-if="!visible.length" class="empty muted">No hay eventos de este tipo en el día.</p>

    <ol v-else class="list">
      <li v-for="e in visible" :key="e.id">
        <button class="item" :class="{ selected: selectedId === e.id }" @click="emit('select', e)">
          <span class="time num">
            {{ fmtClock(e.start) }}
            <small v-if="e.end != null">{{ fmtClock(e.end) }}</small>
          </span>
          <span class="node" :style="{ '--c': CATEGORY_COLOR[e.category] ?? 'var(--text-2)' }">
            <component :is="iconFor(e.icon)" class="icon icon-sm" />
          </span>
          <span class="body">
            <span class="title-row">
              <span class="title">{{ e.title }}</span>
              <span class="sources">
                <SourceBadge v-for="s in sourcesOf(e)" :key="s" :source="s" :size="18" />
              </span>
            </span>
            <span class="subtitle">{{ e.subtitle }}</span>
            <span v-if="e.metrics?.length" class="metrics">
              <span v-for="m in e.metrics.slice(0, 4)" :key="m.label">
                <span class="muted">{{ m.label }}</span> {{ metricText(m) }}
              </span>
            </span>
          </span>
        </button>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.filters {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 14px;
  scrollbar-width: none;
}

.filters button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.filters button:hover {
  border-color: var(--border-strong);
  color: var(--text);
}

.filters button.active {
  background: var(--text);
  border-color: var(--text);
  color: var(--inverse);
}

.count {
  font-variant-numeric: tabular-nums;
  opacity: 0.6;
}

.empty {
  padding: 32px 0;
  text-align: center;
}

.list {
  position: relative;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Raíl vertical que une los nodos */
.list::before {
  content: '';
  position: absolute;
  top: 18px;
  bottom: 18px;
  left: 75px;
  width: 1px;
  background: var(--grid);
}

.item {
  position: relative;
  display: grid;
  grid-template-columns: 48px 28px 1fr;
  gap: 14px;
  width: 100%;
  padding: 10px 12px 10px 0;
  border: 0;
  border-radius: 12px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.item:hover {
  background: var(--surface-hover);
}

.item.selected {
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--border-strong);
}

.time {
  display: grid;
  justify-items: end;
  align-content: start;
  padding-top: 4px;
  font-size: 13px;
  font-weight: 600;
}

.time small {
  font-size: 11px;
  font-weight: 400;
  color: var(--muted);
}

.node {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin-top: 0;
  border-radius: 50%;
  background: var(--page);
  border: 1.5px solid var(--c);
  color: var(--c);
}

.item:hover .node,
.item.selected .node {
  background: var(--surface);
}

.body {
  display: grid;
  gap: 3px;
  min-width: 0;
  padding-top: 3px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.title {
  font-weight: 600;
}

.sources {
  display: inline-flex;
  gap: 3px;
  margin-left: auto;
}

.subtitle {
  color: var(--text-2);
  font-size: 13px;
}

.metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-top: 4px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
</style>
