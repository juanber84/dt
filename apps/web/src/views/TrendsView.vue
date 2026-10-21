<script setup>
import { computed, ref } from 'vue';
import Segmented from '../components/ui/Segmented.vue';
import MetricCard from '../components/trends/MetricCard.vue';
import LineChart from '../components/charts/LineChart.vue';
import BarChart from '../components/charts/BarChart.vue';
import { STAGE_COLOR } from '../components/charts/colors.js';
import { useAsync } from '../composables/useAsync.js';
import CardSkeleton from '../components/ui/CardSkeleton.vue';
import { fetchSummaries, fetchPreviousSummaries } from '../services/twin.js';
import { formatShortDate } from '../lib/dates.js';
import { fmtCompact, fmtDec, fmtDuration, fmtInt, hourTicks } from '../lib/format.js';

const RANGES = [
  { value: 7, label: '7 días' },
  { value: 30, label: '30 días' },
  { value: 90, label: '90 días' },
];
const range = ref(30);

const {
  data,
  error: loadError,
  stale,
  reload: retry,
} = useAsync(range, async (days) => ({
  current: await fetchSummaries(days),
  previous: await fetchPreviousSummaries(days),
}));

const days = computed(() => data.value?.current ?? []);
const labels = computed(() => days.value.map((d) => formatShortDate(d.date)));
const pick = (list, key) => list.map((d) => (typeof key === 'function' ? key(d) : d[key]));
const mean = (values) => {
  const v = values.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** Media del periodo y diferencia con el anterior. */
function stat(key) {
  const now = mean(pick(days.value, key));
  const before = mean(pick(data.value?.previous ?? [], key));
  return { now, delta: now != null && before != null ? now - before : null };
}

const table = (columns, ...getters) => ({
  columns: ['Fecha', ...columns],
  rows: days.value.map((d) => [formatShortDate(d.date), ...getters.map((g) => g(d))]).reverse(),
});

const recoveryColor = (v) =>
  v >= 67 ? 'var(--good)' : v >= 34 ? 'var(--warning)' : 'var(--critical)';

const cards = computed(() => {
  if (!days.value.length) return null;
  return {
    recovery: stat('recovery'),
    hrv: stat('hrv'),
    rhr: stat('rhr'),
    sleep: stat((d) => d.sleep.minutes),
    steps: stat('steps'),
    weight: stat('weight'),
    kcal: stat((d) => d.nutrition.kcal),
    vo2: stat('vo2max'),
  };
});
</script>

<template>
  <div class="trends">
    <header class="page-head">
      <div>
        <h1>Tendencias</h1>
        <p class="muted">Medias del periodo comparadas con el periodo anterior.</p>
      </div>
      <Segmented v-model="range" :options="RANGES" label="Periodo" />
    </header>

    <div v-if="loadError" class="card card-pad load-error" role="alert">
      <p>No se han podido cargar tus datos ({{ loadError.message }}).</p>
      <button class="btn" @click="retry">Reintentar</button>
    </div>

    <div v-if="stale" class="grid" aria-busy="true" aria-label="Cargando tendencias">
      <CardSkeleton v-for="n in 6" :key="n" />
    </div>

    <div v-else-if="cards" class="grid">
      <!-- La recuperación aún no se calcula: sin dato real, la tarjeta no sale -->
      <MetricCard
        v-if="cards.recovery.now != null"
        title="Recuperación"
        subtitle="Alta ≥ 67 · media 34–66 · baja < 34"
        :value="fmtInt(cards.recovery.now)"
        unit="%"
        :delta="cards.recovery.delta"
        :table="table(['Recuperación (%)'], (d) => d.recovery)"
      >
        <template #legend>
          <span><span class="dot" style="background: var(--good)" />Alta</span>
          <span><span class="dot" style="background: var(--warning)" />Media</span>
          <span><span class="dot" style="background: var(--critical)" />Baja</span>
        </template>
        <BarChart
          :labels="labels"
          :series="[
            {
              id: 'rec',
              label: 'Recuperación',
              color: 'var(--text)',
              values: pick(days, 'recovery'),
            },
          ]"
          :color-for="recoveryColor"
          :format="(v) => `${fmtInt(v)} %`"
          :tick-format="fmtInt"
        />
      </MetricCard>

      <MetricCard
        title="VFC"
        subtitle="Variabilidad de la frecuencia cardiaca nocturna. Franja: tu rango normal."
        :value="fmtInt(cards.hrv.now)"
        unit="ms"
        :delta="cards.hrv.delta"
        :table="
          table(
            ['VFC (ms)', 'Media (ms)'],
            (d) => d.hrv,
            (d) => d.hrvBaseline,
          )
        "
      >
        <LineChart
          :labels="labels"
          :series="[{ id: 'hrv', label: 'VFC', color: 'var(--sleep)', values: pick(days, 'hrv') }]"
          :band="{
            low: pick(days, (d) =>
              d.hrvBaseline == null ? null : Math.round(d.hrvBaseline * 0.9),
            ),
            high: pick(days, (d) =>
              d.hrvBaseline == null ? null : Math.round(d.hrvBaseline * 1.1),
            ),
            label: 'Rango normal',
          }"
          :format="(v) => `${fmtInt(v)} ms`"
          :tick-format="fmtInt"
        />
      </MetricCard>

      <MetricCard
        title="FC en reposo"
        :value="fmtInt(cards.rhr.now)"
        unit="ppm"
        :delta="cards.rhr.delta"
        good-when="down"
        :table="table(['FC reposo (ppm)'], (d) => d.rhr)"
      >
        <LineChart
          :labels="labels"
          :series="[
            {
              id: 'rhr',
              label: 'FC en reposo',
              color: 'var(--hr-line)',
              values: pick(days, 'rhr'),
              area: true,
            },
          ]"
          :format="(v) => `${fmtInt(v)} ppm`"
          :tick-format="fmtInt"
        />
      </MetricCard>

      <MetricCard
        title="Sueño"
        subtitle="Por fases. Línea: lo que necesitas."
        :value="fmtDuration(cards.sleep.now)"
        :delta="cards.sleep.delta"
        delta-unit=" min"
        :table="
          table(
            ['Total', 'Profundo', 'Ligero', 'REM'],
            (d) => fmtDuration(d.sleep.minutes),
            (d) => fmtDuration(d.sleep.deep),
            (d) => fmtDuration(d.sleep.light),
            (d) => fmtDuration(d.sleep.rem),
          )
        "
      >
        <template #legend>
          <span><span class="dot" :style="{ background: STAGE_COLOR.deep }" />Profundo</span>
          <span><span class="dot" :style="{ background: STAGE_COLOR.light }" />Ligero</span>
          <span><span class="dot" :style="{ background: STAGE_COLOR.rem }" />REM</span>
        </template>
        <BarChart
          :labels="labels"
          :series="[
            {
              id: 'deep',
              label: 'Profundo',
              color: STAGE_COLOR.deep,
              values: pick(days, (d) => d.sleep.deep),
            },
            {
              id: 'light',
              label: 'Ligero',
              color: STAGE_COLOR.light,
              values: pick(days, (d) => d.sleep.light),
            },
            {
              id: 'rem',
              label: 'REM',
              color: STAGE_COLOR.rem,
              values: pick(days, (d) => d.sleep.rem),
            },
          ]"
          :target="480"
          target-label="Necesidad"
          :format="fmtDuration"
          :y-ticks="
            hourTicks(
              Math.max(480, ...pick(days, (d) => d.sleep.deep + d.sleep.light + d.sleep.rem)),
            )
          "
          :tick-format="(v) => `${v / 60}h`"
        />
      </MetricCard>

      <MetricCard
        title="Pasos"
        :value="fmtInt(cards.steps.now)"
        :delta="cards.steps.delta"
        :table="table(['Pasos'], (d) => fmtInt(d.steps))"
      >
        <BarChart
          :labels="labels"
          :series="[
            { id: 'steps', label: 'Pasos', color: 'var(--activity)', values: pick(days, 'steps') },
          ]"
          :target="10000"
          :format="fmtInt"
          :tick-format="fmtCompact"
        />
      </MetricCard>

      <MetricCard
        title="Peso"
        subtitle="Báscula Xiaomi (los días sin pesaje quedan en blanco)."
        :value="fmtDec(cards.weight.now, 1)"
        unit="kg"
        :delta="cards.weight.delta"
        :delta-digits="1"
        delta-unit=" kg"
        good-when="none"
        :table="
          table(
            ['Peso (kg)', 'Grasa (%)'],
            (d) => fmtDec(d.weight, 1),
            (d) => fmtDec(d.bodyFat, 1),
          )
        "
      >
        <LineChart
          :labels="labels"
          :series="[
            { id: 'weight', label: 'Peso', color: 'var(--text)', values: pick(days, 'weight') },
          ]"
          :format="(v) => `${fmtDec(v, 1)} kg`"
          :tick-format="(v) => fmtDec(v, 1)"
          :min-span="12"
        />
      </MetricCard>

      <MetricCard
        title="Calorías"
        subtitle="Lo que comes frente a lo que gastas."
        :value="fmtInt(cards.kcal.now)"
        unit="kcal"
        :delta="cards.kcal.delta"
        good-when="none"
        :table="
          table(
            ['Consumidas', 'Gasto total'],
            (d) => fmtInt(d.nutrition.kcal),
            (d) => fmtInt(d.totalKcal),
          )
        "
      >
        <template #legend>
          <span><span class="dot" style="background: var(--nutrition)" />Consumidas</span>
          <span><span class="dot" style="background: var(--text-2)" />Gasto total</span>
        </template>
        <LineChart
          :labels="labels"
          :series="[
            {
              id: 'in',
              label: 'Consumidas',
              color: 'var(--nutrition)',
              values: pick(days, (d) => d.nutrition.kcal),
            },
            {
              id: 'out',
              label: 'Gasto total',
              color: 'var(--text-2)',
              values: pick(days, 'totalKcal'),
            },
          ]"
          :format="(v) => `${fmtInt(v)} kcal`"
          :tick-format="fmtCompact"
        />
      </MetricCard>

      <MetricCard
        title="VO2 máx."
        subtitle="Estimación del reloj."
        :value="fmtDec(cards.vo2.now, 1)"
        :delta="cards.vo2.delta"
        :delta-digits="1"
        :table="table(['VO2 máx.'], (d) => fmtDec(d.vo2max, 1))"
      >
        <LineChart
          :labels="labels"
          :series="[
            {
              id: 'vo2',
              label: 'VO2 máx.',
              color: 'var(--activity)',
              values: pick(days, 'vo2max'),
            },
          ]"
          :format="(v) => fmtDec(v, 1)"
          :tick-format="(v) => fmtDec(v, 1)"
        />
      </MetricCard>
    </div>
  </div>
</template>

<style scoped>
.load-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  color: var(--critical-text);
}

.trends {
  max-width: 1280px;
  margin: 0 auto;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}

.page-head p {
  margin-top: 2px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

@media (max-width: 1000px) {
  .grid {
    grid-template-columns: 1fr;
  }

  .page-head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
