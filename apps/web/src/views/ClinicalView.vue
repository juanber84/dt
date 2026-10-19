<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ChevronRight, FileUp } from '@lucide/vue';
import Segmented from '../components/ui/Segmented.vue';
import StatusPill from '../components/ui/StatusPill.vue';
import Sparkline from '../components/charts/Sparkline.vue';
import RangeGauge from '../components/clinical/RangeGauge.vue';
import { useAsync } from '../composables/useAsync.js';
import { iconFor } from '../lib/icons.js';
import { addDays, formatShortDate, todayISO } from '../lib/dates.js';
import {
  CATEGORIES,
  FLAG_LABEL,
  TYPE_ICON,
  TYPE_LABEL,
  categoryOf,
  clinicalOverview,
  documentDay,
  fmtDocDate,
  fmtNumber,
  fmtUnit,
  historyCells,
  listDocuments,
  listParameters,
  parameterGroups,
  rangeText,
  statusPill,
} from '../services/clinical.js';

/**
 * Clínica: para consultar. Arriba el resumen, luego cómo evoluciona cada valor y el historial de
 * analíticas, pruebas e informes. Se suben y se revisan desde Hoy (Registrar → Informe), y cada
 * fila lleva a su día con el informe abierto en el lateral.
 */
const router = useRouter();
const FILTERS = [{ value: 'all', label: 'Todo' }, ...CATEGORIES];
const filter = ref('all');

const load = () => Promise.all([listDocuments(), listParameters()]);
const { data, error, reload } = useAsync(ref(0), load);
const documents = computed(() => data.value?.[0] ?? []);
const parameters = computed(() => data.value?.[1] ?? []);

const overview = computed(() => clinicalOverview(documents.value, parameters.value));
const history = computed(() =>
  documents.value
    .filter((d) => filter.value === 'all' || categoryOf(d.type) === filter.value)
    .map((d) => ({ ...d, day: documentDay(d) }))
    .sort((a, b) => b.day.localeCompare(a.day) || b.createdAt.localeCompare(a.createdAt)),
);
const groups = computed(() =>
  filter.value === 'report' ? [] : parameterGroups(parameters.value, documents.value, filter.value),
);

const flaggedNames = computed(() =>
  overview.value.flaggedNow
    .slice(0, 3)
    .map((p) => p.name)
    .join(', '),
);
const headline = computed(() => {
  const o = overview.value;
  if (!documents.value.length) return 'Aún no hay informes.';
  const parts = [];
  if (o.lastLab) parts.push(`Última analítica el ${fmtDocDate(o.lastLab.date)}`);
  if (o.pending) parts.push(`${o.pending} por revisar en su día`);
  return parts.length ? `${parts.join(' · ')}.` : 'Tus pruebas e informes médicos.';
});

function open(doc) {
  const params = doc.day === todayISO() ? {} : { date: doc.day };
  router.push({ name: 'day', params, query: { event: `clinical-${doc.id}` } });
}

const dayLabel = (iso) =>
  iso === todayISO() ? 'Hoy' : iso === addDays(todayISO(), -1) ? 'Ayer' : fmtDocDate(iso);
const latestText = (p) =>
  p.latest.value != null ? fmtNumber(p.latest.value) : (p.latest.text ?? '—');
const deltaText = (p) =>
  `${p.delta > 0 ? '+' : ''}${fmtNumber(Math.round(p.delta * 100) / 100)} desde el ${formatShortDate(p.previous.date)}`;
const gaugeLabel = (p) =>
  `${p.name}: ${latestText(p)} ${fmtUnit(p.latest.unit)} · rango ${rangeText(p.latest) || 'sin rango'}`;
const subtitleOf = (d) => [TYPE_LABEL[d.type], d.diagnosis ?? d.center].filter(Boolean).join(' · ');
</script>

<template>
  <div class="clinical">
    <header class="page-head">
      <div>
        <h1>Clínica</h1>
        <p class="muted">{{ headline }}</p>
      </div>
      <Segmented v-model="filter" :options="FILTERS" label="Categoría" />
    </header>

    <div v-if="error" class="card card-pad load-error" role="alert">
      <p>No se ha podido cargar ({{ error.message }}).</p>
      <button class="btn" @click="reload">Reintentar</button>
    </div>

    <div v-if="data && !documents.length" class="card empty">
      <FileUp class="icon big" />
      <h2>Sube tu primer informe</h2>
      <p class="secondary">
        Desde Hoy, en Registrar → Informe: analíticas, pruebas (holter, esfuerzo, ECG, ecografía…) o
        informes médicos. Se le quitan tus datos personales antes de leerlo con la IA, va al día de
        la prueba y nada entra en tu timeline hasta que lo revisas.
      </p>
      <RouterLink :to="{ name: 'day', query: { add: 'report' } }" class="btn btn-primary">
        <FileUp class="icon icon-sm" /> Subir un informe
      </RouterLink>
    </div>

    <template v-else-if="data">
      <section class="tiles">
        <div class="card tile">
          <span class="section-label">Última analítica</span>
          <strong>{{ overview.lastLab ? formatShortDate(overview.lastLab.date) : '—' }}</strong>
          <p class="muted">
            <template v-if="overview.lastLab">
              {{
                overview.lastLab.counts.flagged
                  ? `${overview.lastLab.counts.flagged} fuera de rango`
                  : 'Todo en rango'
              }}
              · {{ overview.labs }} {{ overview.labs === 1 ? 'analítica' : 'analíticas' }}
            </template>
            <template v-else>Sin analíticas</template>
          </p>
        </div>
        <div class="card tile">
          <span class="section-label">Fuera de rango ahora</span>
          <strong :class="{ alert: overview.flaggedNow.length }">{{
            overview.flaggedNow.length
          }}</strong>
          <p class="muted">
            {{ flaggedNames || 'Tu último valor de cada parámetro está en rango' }}
            <template v-if="overview.flaggedNow.length > 3">…</template>
          </p>
        </div>
        <div class="card tile">
          <span class="section-label">Pruebas</span>
          <strong>{{ overview.tests }}</strong>
          <p class="muted">
            <template v-if="overview.lastTest">
              Última: {{ overview.lastTest.title }} · {{ formatShortDate(overview.lastTest.date) }}
            </template>
            <template v-else>Holter, esfuerzo, ECG, imagen…</template>
          </p>
        </div>
        <div class="card tile">
          <span class="section-label">Informes</span>
          <strong>{{ overview.reports }}</strong>
          <p class="muted">
            <template v-if="overview.lastReport">
              Último: {{ overview.lastReport.diagnosis ?? overview.lastReport.title }} ·
              {{ formatShortDate(overview.lastReport.date) }}
            </template>
            <template v-else>Lesiones, consultas, altas…</template>
          </p>
        </div>
      </section>

      <section v-if="filter !== 'report'" class="card values">
        <header>
          <div>
            <h2>Valores</h2>
            <p class="muted">
              Tu último resultado de cada parámetro sobre el rango de tu laboratorio (la franja
              gris). Con más de una medida, la línea muestra cómo ha cambiado.
            </p>
          </div>
        </header>
        <p v-if="!groups.length" class="muted none">Aún no hay valores confirmados.</p>
        <div v-for="g in groups" :key="g.section" class="group">
          <h3>
            {{ g.section }}
            <span class="muted">{{ g.items.length }}</span>
          </h3>
          <div class="params">
            <article
              v-for="p in g.items"
              :key="p.code"
              class="param"
              :class="{ flagged: p.latest.flag }"
            >
              <header>
                <span class="name" :title="p.name">{{ p.name }}</span>
                <span v-if="p.latest.flag" class="flag">{{ FLAG_LABEL[p.latest.flag] }}</span>
              </header>
              <div class="value num">
                <strong>{{ latestText(p) }}</strong>
                <small class="muted">{{ fmtUnit(p.latest.unit) }}</small>
              </div>
              <RangeGauge
                :value="p.latest.value"
                :min="p.latest.rangeMin"
                :max="p.latest.rangeMax"
                :flagged="Boolean(p.latest.flag)"
                :label="gaugeLabel(p)"
              />
              <footer>
                <span class="muted num">{{
                  rangeText(p.latest) || fmtDocDate(p.latest.date)
                }}</span>
                <span v-if="p.trend" class="trend" :title="deltaText(p)">
                  <Sparkline :values="p.trend" :height="18" />
                  <small class="num"
                    >{{ p.delta > 0 ? '+' : ''
                    }}{{ fmtNumber(Math.round(p.delta * 100) / 100) }}</small
                  >
                </span>
              </footer>
            </article>
          </div>
        </div>
      </section>

      <section class="card history">
        <header>
          <h2>Historial</h2>
          <span class="muted"
            >{{ history.length }} {{ history.length === 1 ? 'documento' : 'documentos' }}</span
          >
        </header>
        <p v-if="!history.length" class="muted none">Nada de este tipo todavía.</p>
        <ul v-else>
          <li v-for="d in history" :key="d.id">
            <button class="row" @click="open(d)">
              <span class="type-icon" :class="categoryOf(d.type)">
                <component :is="iconFor(TYPE_ICON[d.type] ?? 'FileText')" class="icon" />
              </span>
              <span class="main">
                <strong>{{ d.title ?? d.fileName }}</strong>
                <span class="muted">{{ dayLabel(d.day) }} · {{ subtitleOf(d) || 'Leyendo…' }}</span>
              </span>
              <span v-for="c in historyCells(d)" :key="c.label" class="cell num hide-sm">
                <small>{{ c.label }}</small>
                <span :class="{ alert: c.alert }">{{ c.value }}</span>
              </span>
              <StatusPill v-if="d.status !== 'confirmed'" v-bind="statusPill(d.status)" />
              <ChevronRight class="icon chevron" />
            </button>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.clinical {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  max-width: 1280px;
  margin: 0 auto;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 8px;
}

.page-head p {
  margin-top: 2px;
}

.load-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--critical-text);
}

.empty {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 40px 24px;
  text-align: center;
}

.empty p {
  max-width: 520px;
}

.icon.big {
  width: 28px;
  height: 28px;
  color: var(--muted);
}

.tiles {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.tile {
  display: grid;
  align-content: start;
  gap: 2px;
  padding: 14px 16px;
}

.tile strong {
  font-size: 26px;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.tile p {
  font-size: 12px;
}

.alert {
  color: var(--critical);
}

.values,
.history {
  padding: 18px 8px 8px;
}

.values > header,
.history > header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  padding: 0 12px 12px;
}

.values > header p {
  font-size: 12px;
  margin-top: 2px;
}

.history > header .muted {
  font-size: 12px;
}

.none {
  padding: 4px 12px 14px;
  font-size: 13px;
}

.group {
  padding: 4px 12px 14px;
}

.group h3 {
  display: flex;
  gap: 6px;
  align-items: baseline;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
}

.group h3 .muted {
  font-size: 12px;
  font-weight: 400;
}

.params {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 8px;
}

.param {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
}

.param.flagged {
  border-color: color-mix(in srgb, var(--critical) 45%, var(--border));
}

.param header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.param .name {
  font-size: 12px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flag {
  flex: none;
  font-size: 11px;
  font-weight: 600;
  color: var(--critical-text);
}

.param .value strong {
  font-size: 18px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.param .value small {
  margin-left: 3px;
  font-size: 11px;
}

.param footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  min-height: 18px;
  font-size: 11px;
}

.trend {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 92px;
  color: var(--text-2);
}

.trend :deep(.spark) {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.trend small {
  flex: none;
  font-size: 11px;
}

.history ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.row:hover {
  background: var(--surface-hover);
}

.type-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  color: var(--text-2);
  background: var(--surface-2);
}

.main {
  flex: 1;
  display: grid;
  min-width: 0;
}

.main strong {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.main .muted {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell {
  display: grid;
  justify-items: end;
  font-size: 13px;
  font-weight: 500;
  min-width: 52px;
}

.cell small {
  font-size: 11px;
  font-weight: 400;
  color: var(--muted);
}

.chevron {
  color: var(--muted);
}

@media (max-width: 1100px) {
  .tiles {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 860px) {
  .params {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .group {
    padding: 4px 4px 14px;
  }

  .page-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .row {
    gap: 10px;
  }

  .hide-sm,
  .chevron {
    display: none;
  }
}
</style>
