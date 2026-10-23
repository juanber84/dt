<script setup>
import { computed } from 'vue';
import { ArrowRight } from '@lucide/vue';
import LineChart from '../charts/LineChart.vue';
import {
  FLAG_LABEL,
  REPORT_KIND_LABEL,
  bySection,
  categoryOf,
  fmtDocDate,
  fmtNumber,
  fmtUnit,
  rangeText,
} from '../../services/clinical.js';

/** Un documento ya confirmado, en limpio: conclusión, datos del informe, valores y el holter. */
const props = defineProps({ draft: { type: Object, required: true } });

const isTest = computed(() => categoryOf(props.draft.type) === 'test');
const isReport = computed(() => props.draft.type === 'report');
const flagged = computed(() => props.draft.items.filter((i) => i.flag));
const valueText = (item) => (item.value != null ? fmtNumber(item.value) : item.text || '—');

const restText = computed(() => {
  const r = props.draft.report;
  if (!r?.restFrom && !r?.restTo) return null;
  if (r.restFrom && r.restTo) return `Del ${fmtDocDate(r.restFrom)} al ${fmtDocDate(r.restTo)}`;
  return r.restTo ? `Hasta el ${fmtDocDate(r.restTo)}` : `Desde el ${fmtDocDate(r.restFrom)}`;
});

const hourlyChart = computed(() => {
  const rows = (props.draft.hourly ?? []).filter((h) => h.hrAvg != null);
  if (rows.length < 2) return null;
  return {
    labels: rows.map((h) => h.end.slice(11)),
    series: [
      {
        id: 'avg',
        label: 'FC media',
        color: 'var(--activity)',
        values: rows.map((h) => h.hrAvg),
      },
    ],
    band: rows.every((h) => h.hrMin != null && h.hrMax != null)
      ? { low: rows.map((h) => h.hrMin), high: rows.map((h) => h.hrMax), label: 'Mín. – máx.' }
      : null,
  };
});
</script>

<template>
  <p v-if="draft.summary" class="conclusion">{{ draft.summary }}</p>

  <section v-if="isReport && draft.report" class="block">
    <dl class="facts">
      <div>
        <dt>Tipo</dt>
        <dd>{{ REPORT_KIND_LABEL[draft.report.kind] }}</dd>
      </div>
      <div v-if="draft.report.specialty">
        <dt>Especialidad</dt>
        <dd>{{ draft.report.specialty }}</dd>
      </div>
      <div v-if="draft.report.diagnosis" class="wide">
        <dt>Diagnóstico</dt>
        <dd>{{ draft.report.diagnosis }}</dd>
      </div>
      <div v-if="draft.report.bodyPart">
        <dt>Zona</dt>
        <dd>{{ draft.report.bodyPart }}</dd>
      </div>
      <div v-if="restText">
        <dt>Reposo</dt>
        <dd>{{ restText }}</dd>
      </div>
    </dl>
    <template v-if="draft.report.recommendations.length">
      <h3>Indicaciones</h3>
      <ul class="bullets">
        <li v-for="r in draft.report.recommendations" :key="r">{{ r }}</li>
      </ul>
    </template>
  </section>

  <section v-if="isTest && draft.items.length" class="block">
    <dl class="facts">
      <div v-for="item in draft.items" :key="item.id">
        <dt>{{ item.name }}</dt>
        <dd>
          {{ valueText(item)
          }}<small v-if="fmtUnit(item.metricUnit ?? item.unit)">
            {{ fmtUnit(item.metricUnit ?? item.unit) }}</small
          >
        </dd>
      </div>
    </dl>
  </section>

  <section v-if="hourlyChart" class="block">
    <h3>Pulso por horas</h3>
    <LineChart v-bind="hourlyChart" :height="160" />
  </section>

  <template v-if="!isTest && draft.items.length">
    <section v-if="flagged.length" class="block">
      <h3>Fuera de rango</h3>
      <ul class="values-list">
        <li v-for="item in flagged" :key="item.id">
          <span class="name">{{ item.name }}</span>
          <span class="num result">
            {{ valueText(item) }} <small class="muted">{{ fmtUnit(item.unit) }}</small>
            <span class="flag">{{ FLAG_LABEL[item.flag] }}</span>
          </span>
          <span class="muted num range">{{ rangeText(item) }}</span>
        </li>
      </ul>
    </section>
    <section class="block">
      <h3>Todos los valores</h3>
      <template v-for="g in bySection(draft.items)" :key="g.section">
        <h4>{{ g.section }}</h4>
        <ul class="values-list">
          <li v-for="item in g.items" :key="item.id">
            <span class="name">{{ item.name }}</span>
            <span class="num result">
              {{ valueText(item) }} <small class="muted">{{ fmtUnit(item.unit) }}</small>
              <span v-if="item.flag" class="flag">{{ FLAG_LABEL[item.flag] }}</span>
            </span>
            <span class="muted num range">{{ rangeText(item) }}</span>
          </li>
        </ul>
      </template>
    </section>
  </template>

  <RouterLink v-if="draft.items.length" :to="{ name: 'clinical' }" class="btn btn-sm evolution">
    Ver la evolución en Clínica <ArrowRight class="icon icon-sm" />
  </RouterLink>
</template>

<style scoped>
.conclusion {
  white-space: pre-line;
  font-size: 14px;
}

.block h3 {
  margin-bottom: 10px;
}

.block h4 {
  margin: 14px 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}

.facts {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1px;
  margin: 0 0 14px;
  border-radius: 12px;
  overflow: hidden;
  background: var(--border);
  border: 1px solid var(--border);
}

.facts div {
  padding: 10px 14px;
  background: var(--surface);
}

.facts .wide {
  grid-column: 1 / -1;
}

.facts dt {
  font-size: 12px;
  color: var(--muted);
}

.facts dd {
  margin: 2px 0 0;
  font-size: 16px;
  font-weight: 600;
}

.facts small {
  font-size: 12px;
  font-weight: 400;
  color: var(--muted);
}

.bullets {
  margin: 0;
  padding-left: 18px;
  font-size: 14px;
}

.values-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.values-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 110px;
  gap: 12px;
  align-items: baseline;
  padding: 6px 0;
  border-top: 1px solid var(--grid);
  font-size: 13px;
}

.values-list .result {
  font-weight: 600;
  text-align: right;
}

.values-list .range {
  font-size: 12px;
  text-align: right;
}

.flag {
  flex: none;
  margin-left: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--critical);
}

.evolution {
  justify-self: start;
}

@media (max-width: 720px) {
  .values-list li {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .values-list .range {
    display: none;
  }
}
</style>
