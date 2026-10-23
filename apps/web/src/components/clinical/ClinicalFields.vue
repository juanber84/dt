<script setup>
import { computed } from 'vue';
import { TriangleAlert } from '@lucide/vue';
import {
  DOCUMENT_ISSUE_LABEL,
  REPORT_KIND_LABEL,
  TYPE_GROUPS,
  categoryOf,
  fromDateTimeInput,
  toDateTimeInput,
} from '../../services/clinical.js';

/**
 * Los datos generales del documento al revisarlo: tipo, fecha, título, centro, lo propio de una
 * prueba (inicio y fin) o de un informe (diagnóstico, reposo, indicaciones) y la conclusión. No
 * cambia el borrador: avisa con `set` (y `set-report`) de lo que cambia.
 */
const props = defineProps({
  draft: { type: Object, required: true },
  /** Problemas del documento entero (documentIssues): fecha rara, sin valores... */
  issues: { type: Array, default: () => [] },
});
const emit = defineEmits(['set', 'set-report']);

const isTest = computed(() => categoryOf(props.draft.type) === 'test');
const isReport = computed(() => props.draft.type === 'report');
const set = (changes) => emit('set', changes);
const setReport = (changes) => emit('set-report', changes);
const recommendationsText = computed({
  get: () => (props.draft.report?.recommendations ?? []).join('\n'),
  set: (text) =>
    setReport({
      recommendations: text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    }),
});
</script>

<template>
  <section class="fields">
    <label class="field">
      <span>Tipo</span>
      <select class="input" :value="draft.type" @change="set({ type: $event.target.value })">
        <optgroup v-for="g in TYPE_GROUPS" :key="g.label" :label="g.label">
          <option v-for="o in g.options" :key="o.value" :value="o.value">
            {{ o.label }}
          </option>
        </optgroup>
      </select>
    </label>
    <label class="field">
      <span>Fecha de la prueba</span>
      <input
        class="input num"
        type="date"
        :value="draft.date ?? ''"
        @change="set({ date: $event.target.value || null })"
      />
    </label>
    <label class="field full">
      <span>Título</span>
      <input class="input" :value="draft.title" @input="set({ title: $event.target.value })" />
    </label>
    <label class="field full">
      <span>Centro</span>
      <input
        class="input"
        :value="draft.center ?? ''"
        @change="set({ center: $event.target.value || null })"
      />
    </label>
    <template v-if="isTest">
      <label class="field">
        <span>Inicio</span>
        <input
          class="input num"
          type="datetime-local"
          :value="toDateTimeInput(draft.start)"
          @change="set({ start: fromDateTimeInput($event.target.value) })"
        />
      </label>
      <label class="field">
        <span>Fin</span>
        <input
          class="input num"
          type="datetime-local"
          :value="toDateTimeInput(draft.end)"
          @change="set({ end: fromDateTimeInput($event.target.value) })"
        />
      </label>
    </template>
    <template v-if="isReport && draft.report">
      <label class="field">
        <span>Qué es</span>
        <select
          class="input"
          :value="draft.report.kind"
          @change="setReport({ kind: $event.target.value })"
        >
          <option v-for="(label, value) in REPORT_KIND_LABEL" :key="value" :value="value">
            {{ label }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>Especialidad</span>
        <input
          class="input"
          :value="draft.report.specialty ?? ''"
          @change="setReport({ specialty: $event.target.value || null })"
        />
      </label>
      <label class="field full">
        <span>Diagnóstico</span>
        <input
          class="input"
          :value="draft.report.diagnosis ?? ''"
          @change="setReport({ diagnosis: $event.target.value || null })"
        />
      </label>
      <label class="field full">
        <span>Zona del cuerpo</span>
        <input
          class="input"
          :value="draft.report.bodyPart ?? ''"
          @change="setReport({ bodyPart: $event.target.value || null })"
        />
      </label>
      <label class="field">
        <span>Reposo desde</span>
        <input
          class="input num"
          type="date"
          :value="draft.report.restFrom ?? ''"
          @change="setReport({ restFrom: $event.target.value || null })"
        />
      </label>
      <label class="field">
        <span>Reposo hasta</span>
        <input
          class="input num"
          type="date"
          :value="draft.report.restTo ?? ''"
          @change="setReport({ restTo: $event.target.value || null })"
        />
      </label>
      <label class="field full">
        <span>Indicaciones (una por línea)</span>
        <textarea v-model.lazy="recommendationsText" class="input" rows="3" />
      </label>
    </template>
    <label v-if="draft.type !== 'lab' || draft.summary" class="field full">
      <span>{{ isReport ? 'Resumen' : 'Conclusión' }}</span>
      <textarea
        class="input"
        rows="3"
        :value="draft.summary"
        @input="set({ summary: $event.target.value })"
      />
    </label>
    <ul v-if="issues.length" class="doc-issues full">
      <li v-for="i in issues" :key="i">
        <TriangleAlert class="icon icon-sm" /> {{ DOCUMENT_ISSUE_LABEL[i] ?? i }}
      </li>
    </ul>
  </section>
</template>

<style scoped>
.fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.fields .full {
  grid-column: 1 / -1;
}

.fields .input {
  width: 100%;
  min-width: 0;
}

.fields .field {
  min-width: 0;
}

.doc-issues {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
  font-size: 13px;
  color: var(--warning-text);
}

.doc-issues li {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
