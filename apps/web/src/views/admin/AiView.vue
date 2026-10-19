<script setup>
import { computed, onMounted, ref } from 'vue';
import { RefreshCw, CircleAlert } from '@lucide/vue';
import AdminHeader from '../../components/admin/AdminHeader.vue';
import StatusPill from '../../components/ui/StatusPill.vue';
import ChartCard from '../../components/ui/ChartCard.vue';
import BarChart from '../../components/charts/BarChart.vue';
import {
  balanceStatus,
  featureLabel,
  fetchAiStatus,
  fmtMoney,
  fmtRunway,
} from '../../services/ai.js';
import { formatShortDate } from '../../lib/dates.js';
import { fmtCompact, fmtInt, fmtRelativeTime } from '../../lib/format.js';

/** Color de cada función en la gráfica; lo demás, tinta neutra. */
const FEATURE_COLOR = {
  coach: 'var(--sleep)',
  'nutrition.analyze': 'var(--nutrition)',
  'nutrition.refine': 'color-mix(in srgb, var(--nutrition) 50%, var(--surface))',
  'clinical.extract': 'var(--activity)',
};
const colorOf = (feature) => FEATURE_COLOR[feature] ?? 'var(--axis)';

const status = ref(null);
const error = ref(null);
const loading = ref(false);
const checkedAt = ref(null);

async function load() {
  loading.value = true;
  try {
    status.value = await fetchAiStatus();
    error.value = null;
  } catch (err) {
    error.value = err;
  } finally {
    loading.value = false;
    checkedAt.value = Date.now();
  }
}

onMounted(load);

const usage = computed(() => status.value?.usage);
const balance = computed(() => status.value?.balance);
const pill = computed(() => balanceStatus(status.value));
const mainBalance = computed(() => balance.value?.balances?.[0]);

const totals = computed(() =>
  usage.value
    ? [
        { label: 'Hoy', ...usage.value.today },
        { label: 'Últimos 7 días', ...usage.value.week },
        { label: 'Este mes', ...usage.value.month },
      ]
    : [],
);

const days = computed(() => usage.value?.days ?? []);
const labels = computed(() => days.value.map((d) => formatShortDate(d.date)));
const features = computed(() => {
  const seen = new Set(days.value.flatMap((d) => Object.keys(d.byFeature)));
  return [...seen].sort();
});
const series = computed(() =>
  features.value.map((feature) => ({
    id: feature,
    label: featureLabel(feature),
    color: colorOf(feature),
    values: days.value.map((d) => d.byFeature[feature] ?? 0),
  })),
);
const chartTable = computed(() => ({
  columns: ['Día', ...features.value.map(featureLabel), 'Total', 'Llamadas'],
  rows: days.value.map((d) => [
    formatShortDate(d.date),
    ...features.value.map((f) => fmtMoney(d.byFeature[f] ?? 0)),
    fmtMoney(d.costUsd),
    fmtInt(d.calls),
  ]),
}));

const prices = computed(() =>
  Object.entries(usage.value?.prices ?? {}).map(([model, p]) => ({ model, ...p })),
);

const fmtTokens = (n) => fmtCompact(n);
const fmtMs = (ms) => (ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
</script>

<template>
  <div class="admin">
    <AdminHeader
      title="IA"
      description="Lo que gastan el coach, el análisis de comidas y la lectura de informes médicos. El saldo lo da el proveedor (DeepSeek); el desglose se apunta en cada llamada y el coste es una estimación con los precios configurados."
    />

    <div class="toolbar">
      <span class="muted">{{
        checkedAt ? `Comprobado ${fmtRelativeTime(checkedAt)}` : 'Comprobando…'
      }}</span>
      <button class="btn btn-sm" :disabled="loading" @click="load">
        <RefreshCw class="icon icon-sm" />
        Actualizar
      </button>
    </div>

    <div v-if="error" class="card card-pad load-error" role="alert">
      <CircleAlert class="icon" />
      No se ha podido cargar ({{ error.message }}).
    </div>

    <template v-if="status">
      <section class="tiles">
        <div class="card tile balance">
          <div class="tile-head">
            <span class="section-label">Saldo</span>
            <StatusPill :tone="pill.tone" :label="pill.label" />
          </div>
          <strong class="big num">{{
            mainBalance ? fmtMoney(mainBalance.total, mainBalance.currency) : '—'
          }}</strong>
          <p class="secondary small">
            <template v-if="balance?.runwayDays != null">
              {{
                fmtRunway(balance.runwayDays)[0].toUpperCase() +
                fmtRunway(balance.runwayDays).slice(1)
              }}
              al ritmo de la última semana.
            </template>
            <template v-else-if="balance?.error">{{ balance.error }}</template>
            <template v-else-if="!balance">El proveedor no dice el saldo.</template>
            <template v-else>Sin gasto en la última semana para estimar.</template>
          </p>
          <p v-if="mainBalance && mainBalance.granted > 0" class="muted small">
            {{ fmtMoney(mainBalance.toppedUp, mainBalance.currency) }} recargado ·
            {{ fmtMoney(mainBalance.granted, mainBalance.currency) }} regalado
          </p>
        </div>
        <div v-for="t in totals" :key="t.label" class="card tile">
          <span class="section-label">{{ t.label }}</span>
          <strong class="big num">{{ fmtMoney(t.costUsd) }}</strong>
          <p class="secondary small">
            {{ fmtInt(t.calls) }} llamadas<template v-if="t.errors">
              · <span class="bad">{{ fmtInt(t.errors) }} con error</span></template
            >
          </p>
        </div>
      </section>

      <ChartCard
        title="Gasto por día"
        subtitle="Últimos 30 días, en USD"
        :table="chartTable"
        class="chart"
      >
        <template #legend>
          <span v-for="s in series" :key="s.id">
            <span class="dot" :style="{ background: s.color }" />{{ s.label }}
          </span>
        </template>
        <BarChart
          v-if="series.length"
          :labels="labels"
          :series="series"
          :format="(v) => fmtMoney(v)"
          :tick-format="(v) => fmtMoney(v)"
          :height="180"
        />
        <p v-else class="muted empty">Aún no hay llamadas apuntadas.</p>
      </ChartCard>

      <div class="cols">
        <section>
          <h2 class="sub">Por función <span class="muted">· 30 días</span></h2>
          <div class="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Función</th>
                  <th class="num">Llamadas</th>
                  <th class="num" title="Tokens de entrada (de ellos, de caché)">Entrada</th>
                  <th class="num">Salida</th>
                  <th class="num">Coste</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="f in usage.features" :key="f.feature">
                  <td>
                    <span class="dot" :style="{ background: colorOf(f.feature) }" />
                    {{ featureLabel(f.feature) }}
                  </td>
                  <td class="num">{{ fmtInt(f.calls) }}</td>
                  <td class="num">
                    {{ fmtTokens(f.inputTokens) }}
                    <span class="muted">({{ fmtTokens(f.cachedTokens) }})</span>
                  </td>
                  <td class="num">{{ fmtTokens(f.outputTokens) }}</td>
                  <td class="num">{{ fmtMoney(f.costUsd) }}</td>
                </tr>
                <tr v-if="!usage.features.length">
                  <td colspan="5" class="muted">Sin llamadas.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 class="sub">Modelos</h2>
          <ul class="card models">
            <li v-for="m in status.models" :key="m.feature">
              <div class="info">
                <strong>{{ featureLabel(m.feature) }}</strong>
                <span class="muted mono">{{ m.model }} · {{ m.host }}</span>
              </div>
              <StatusPill
                :tone="m.configured ? 'good' : 'neutral'"
                :label="m.configured ? 'Activo' : 'Sin configurar'"
              />
            </li>
          </ul>
          <p class="muted small prices">
            Precios (USD por millón de tokens, entrada / caché / salida):
            <template v-for="(p, i) in prices" :key="p.model">
              <span class="mono">{{ p.model }}</span> {{ p.input }} / {{ p.cached }} / {{ p.output
              }}<template v-if="i < prices.length - 1"> · </template>
            </template>
            . Se cambian con <code>LLM_PRICES</code>.
          </p>
        </section>
      </div>

      <h2 class="sub">Últimas llamadas</h2>
      <div class="card table-wrap">
        <table class="recent">
          <thead>
            <tr>
              <th>Cuándo</th>
              <th>Función</th>
              <th>Modelo</th>
              <th class="num">Entrada</th>
              <th class="num">Salida</th>
              <th class="num">Duración</th>
              <th class="num">Coste</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in usage.recent" :key="i" :class="{ failed: r.error }">
              <td :title="new Date(r.at).toLocaleString('es-ES')">{{ fmtRelativeTime(r.at) }}</td>
              <td>
                {{ featureLabel(r.feature) }}
                <RouterLink
                  v-if="r.conversationId"
                  :to="{ name: 'coach', params: { id: r.conversationId } }"
                  class="muted link"
                  >ver</RouterLink
                >
                <p v-if="r.error" class="bad small">{{ r.error }}</p>
              </td>
              <td class="mono muted">{{ r.model }}</td>
              <td class="num">
                {{ fmtTokens(r.inputTokens) }}
                <span v-if="r.cachedTokens" class="muted">({{ fmtTokens(r.cachedTokens) }})</span>
              </td>
              <td class="num">{{ fmtTokens(r.outputTokens) }}</td>
              <td class="num">{{ fmtMs(r.durationMs) }}</td>
              <td class="num">{{ fmtMoney(r.costUsd) }}</td>
            </tr>
            <tr v-if="!usage.recent.length">
              <td colspan="7" class="muted">Sin llamadas en los últimos 30 días.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.admin {
  max-width: 1040px;
  margin: 0 auto;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  font-size: 12px;
}

.load-error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  color: var(--critical-text);
}

.tiles {
  display: grid;
  grid-template-columns: 1.4fr repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 12px;
}

.tile {
  display: grid;
  align-content: start;
  gap: 4px;
  padding: 14px 16px;
}

.tile-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.big {
  font-size: 24px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.small {
  margin: 0;
  font-size: 12px;
}

.bad {
  color: var(--critical-text);
}

.chart {
  margin-bottom: 20px;
}

.empty {
  padding: 32px 0;
  text-align: center;
}

.cols {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 16px;
}

.sub {
  margin: 4px 0 8px;
  font-size: 14px;
}

.table-wrap {
  overflow-x: auto;
  margin-bottom: 20px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th,
td {
  padding: 8px 14px;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid var(--grid);
}

tr:last-child td {
  border-bottom: 0;
}

th {
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
}

th.num,
td.num {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

td .dot {
  margin-right: 6px;
}

.recent td p {
  margin: 2px 0 0;
  max-width: 360px;
}

.link {
  margin-left: 6px;
  font-size: 12px;
  text-decoration: underline;
}

.mono {
  font-family: var(--mono);
  font-size: 12px;
}

.models {
  margin: 0 0 8px;
  padding: 0;
  list-style: none;
}

.models li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
}

.models li + li {
  border-top: 1px solid var(--grid);
}

.models .info {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.prices {
  line-height: 1.5;
}

@media (max-width: 860px) {
  .tiles {
    grid-template-columns: 1fr 1fr;
  }

  .tiles .balance {
    grid-column: 1 / -1;
  }

  .cols {
    grid-template-columns: 1fr;
  }
}
</style>
