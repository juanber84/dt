<script setup>
import { computed, ref } from 'vue';
import { CircleCheck, Info, TriangleAlert } from '@lucide/vue';
import {
  FLAG_LABEL,
  ISSUE_LABEL,
  SKIP,
  bySection,
  fmtUnit,
  metricChoice,
  needsLook,
} from '../../services/clinical.js';

/**
 * La tabla de valores al revisar: cada uno con su resultado, unidad, rango y en qué métrica se
 * guarda, y lo que hay que comprobar. No cambia los valores: avisa con `set-item` y `set-metric`
 * (con el índice del valor en `items`).
 */
const props = defineProps({
  items: { type: Array, required: true },
  /** Las métricas del catálogo para "Se guarda como", agrupadas (metricGroups). */
  metricOptions: { type: Array, default: () => [] },
  isTest: { type: Boolean, default: false },
});
const emit = defineEmits(['set-item', 'set-metric']);

const onlyIssues = ref(false);
const groups = computed(() =>
  bySection(props.items.filter((item) => !onlyIssues.value || needsLook(item) || item.flag)),
);
const withIssues = computed(() => props.items.filter(needsLook).length);
const indexOf = (item) => props.items.findIndex((i) => i.id === item.id);
const issueText = (item) =>
  item.issues
    .map((i) => ISSUE_LABEL[i])
    .filter(Boolean)
    .join('\n');
</script>

<template>
  <section class="values">
    <header class="values-head">
      <div>
        <h3>{{ isTest ? 'Medidas' : 'Valores' }}</h3>
        <p class="muted">
          {{ items.length }} leídos<template v-if="withIssues">
            · {{ withIssues }} por comprobar</template
          >
        </p>
      </div>
      <label class="check">
        <input v-model="onlyIssues" type="checkbox" />
        Solo avisos y fuera de rango
      </label>
    </header>

    <div class="grid-head hide-sm" aria-hidden="true">
      <span>Parámetro</span><span>Resultado</span><span>Unidad</span><span>Rango</span
      ><span>Se guarda como</span><span />
    </div>

    <template v-for="g in groups" :key="g.section">
      <h4 class="group">{{ g.section }}</h4>
      <div
        v-for="item in g.items"
        :key="item.id"
        class="row"
        :class="{ look: needsLook(item), skipped: item.skip }"
      >
        <input
          class="input name"
          :value="item.name"
          aria-label="Parámetro"
          @change="emit('set-item', indexOf(item), { name: $event.target.value })"
        />
        <span class="result">
          <input
            class="input num"
            :value="item.text"
            aria-label="Resultado"
            @change="emit('set-item', indexOf(item), { text: $event.target.value })"
          />
          <span v-if="item.flag" class="flag">{{ FLAG_LABEL[item.flag] }}</span>
        </span>
        <input
          class="input"
          :value="item.unit ?? ''"
          aria-label="Unidad"
          @change="emit('set-item', indexOf(item), { unit: $event.target.value || null })"
        />
        <input
          class="input num"
          :value="item.rangeText ?? ''"
          aria-label="Rango"
          placeholder="—"
          @change="emit('set-item', indexOf(item), { rangeText: $event.target.value || null })"
        />
        <select
          class="input"
          :value="metricChoice(item)"
          aria-label="Se guarda como"
          @change="emit('set-metric', indexOf(item), $event.target.value)"
        >
          <option value="">{{ item.metric ? 'Automática' : 'Nuevo parámetro' }}</option>
          <option :value="SKIP">No guardar en el timeline</option>
          <optgroup v-for="mg in metricOptions" :key="mg.section" :label="mg.section">
            <option v-for="m in mg.options" :key="m.code" :value="m.code">
              {{ m.label }}{{ fmtUnit(m.unit) ? ` (${fmtUnit(m.unit)})` : '' }}
            </option>
          </optgroup>
        </select>
        <span class="state" :title="issueText(item)">
          <TriangleAlert v-if="needsLook(item)" class="icon warn" />
          <Info v-else-if="item.issues.length" class="icon muted" />
          <CircleCheck v-else class="icon ok" />
          <span class="sr-only">{{ issueText(item) || 'Comprobado' }}</span>
        </span>
        <p v-if="needsLook(item) || item.comment" class="row-note">
          <template v-if="needsLook(item)">{{ issueText(item) }}</template>
          <template v-else>{{ item.comment }}</template>
        </p>
      </div>
    </template>
    <p v-if="!groups.length" class="muted none">Nada con avisos ni fuera de rango.</p>
  </section>
</template>

<style scoped>
.values {
  margin: 0 -20px;
}

.values-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  padding: 0 20px 10px;
}

.values-head p {
  font-size: 12px;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-2);
  cursor: pointer;
}

.grid-head,
.row {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) 88px 72px 96px minmax(0, 1.2fr) 20px;
  gap: 6px;
  align-items: center;
  padding: 0 20px;
}

.grid-head {
  padding-bottom: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
}

.group {
  margin: 0;
  padding: 12px 20px 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  border-top: 1px solid var(--border);
}

.row {
  padding-top: 3px;
  padding-bottom: 3px;
}

.row .input {
  height: 30px;
  padding: 0 7px;
  min-width: 0;
  width: 100%;
  font-size: 13px;
}

.row.look {
  background: color-mix(in srgb, var(--warning) 10%, transparent);
}

.row.skipped .input {
  color: var(--muted);
}

.result {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}

.flag {
  flex: none;
  margin-left: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--critical);
}

.state {
  display: grid;
  place-items: center;
}

.icon.warn {
  color: var(--warning-text);
}

.icon.ok {
  color: var(--good-text);
}

.row-note {
  grid-column: 1 / -1;
  margin: -1px 0 4px;
  font-size: 12px;
  color: var(--text-2);
  white-space: pre-line;
}

.row.look .row-note {
  color: var(--warning-text);
}

.none {
  padding: 12px 20px;
  font-size: 13px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

@media (max-width: 720px) {
  .hide-sm {
    display: none;
  }

  /* En el móvil cada valor es una ficha: nombre arriba, resultado/unidad/rango y la métrica */
  .row {
    grid-template-columns: repeat(3, minmax(0, 1fr)) 20px;
    padding-top: 10px;
    padding-bottom: 10px;
    border-top: 1px solid var(--border);
  }

  .row .name {
    grid-column: 1 / 4;
  }

  .row .state {
    grid-column: 4;
    grid-row: 1;
  }

  .row select {
    grid-column: 1 / -1;
  }
}
</style>
