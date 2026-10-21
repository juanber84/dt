<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ChevronRight } from '@lucide/vue';
import ChartCard from '../components/ui/ChartCard.vue';
import Segmented from '../components/ui/Segmented.vue';
import LineChart from '../components/charts/LineChart.vue';
import BarChart from '../components/charts/BarChart.vue';
import { useAsync } from '../composables/useAsync.js';
import Skeleton from '../components/ui/Skeleton.vue';
import CardSkeleton from '../components/ui/CardSkeleton.vue';
import { fetchActivities, fetchSummaries } from '../services/twin.js';
import { iconFor } from '../lib/icons.js';
import {
  addDays,
  formatShortDate,
  formatWeekday,
  parseISODate,
  todayISO,
  toISODate,
} from '../lib/dates.js';
import { fmtDec, fmtDuration, fmtInt, fmtSigned, hourTicks } from '../lib/format.js';

const router = useRouter();
const RANGES = [
  { value: 42, label: '6 semanas' },
  { value: 90, label: '3 meses' },
  { value: 180, label: '6 meses' },
];
const range = ref(90);
const shown = ref(12);

const {
  data: summaries,
  error: loadError,
  stale,
  reload: retry,
} = useAsync(range, (days) => fetchSummaries(days));
const { data: list, stale: listStale } = useAsync(range, (days) => fetchActivities(days));

const days = computed(() => summaries.value ?? []);
const labels = computed(() => days.value.map((d) => formatShortDate(d.date)));
// La carga es la de intervals.icu: el último día que la tenga (hoy puede no estar aún)
const last = computed(() => days.value.findLast((d) => d.load)?.load);
const round = (v) => (v == null ? null : Math.round(v));

const formState = computed(() => {
  if (!last.value) return 'Sin datos de carga: conecta intervals.icu.';
  const tsb = last.value.tsb;
  if (tsb > 10) return 'Fresco: buen momento para competir o apretar.';
  if (tsb > -10) return 'Equilibrado: puedes entrenar con normalidad.';
  if (tsb > -30) return 'Cargando: fatiga productiva, vigila la recuperación.';
  return 'Demasiada fatiga: toca descargar.';
});

// Volumen semanal (semanas de lunes a domingo)
const weeks = computed(() => {
  const map = new Map();
  for (const a of list.value ?? []) {
    const d = parseISODate(a.date);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key = toISODate(d);
    const w = map.get(key) ?? { week: key, minutes: 0, tss: 0, sessions: 0 };
    w.minutes += a.minutes;
    w.tss += a.tss ?? 0;
    w.sessions += 1;
    map.set(key, w);
  }
  return [...map.values()].sort((a, b) => a.week.localeCompare(b.week));
});

const thisWeek = computed(() => {
  const d = parseISODate(todayISO());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return weeks.value.find((w) => w.week === toISODate(d)) ?? { minutes: 0, tss: 0, sessions: 0 };
});

const pmcTable = computed(() => ({
  columns: ['Fecha', 'Fitness', 'Fatiga', 'Forma', 'TSS'],
  rows: days.value
    .filter((d) => d.load)
    .map((d) => [
      formatShortDate(d.date),
      fmtInt(d.load.ctl),
      fmtInt(d.load.atl),
      fmtSigned(d.load.tsb),
      d.load.tss,
    ])
    .reverse(),
}));

function open(activity) {
  const params = activity.date === todayISO() ? {} : { date: activity.date };
  router.push({ name: 'day', params, query: { event: activity.id } });
}

const formatDistance = (a) => (a.distanceKm ? `${fmtDec(a.distanceKm, 1)} km` : '—');
const formatPace = (a) =>
  a.paceSecPerKm
    ? `${Math.floor(a.paceSecPerKm / 60)}:${String(a.paceSecPerKm % 60).padStart(2, '0')} /km`
    : a.avgPower
      ? `${a.avgPower} W`
      : '—';
const dayLabel = (iso) =>
  iso === todayISO()
    ? 'Hoy'
    : iso === addDays(todayISO(), -1)
      ? 'Ayer'
      : `${formatWeekday(iso)} ${formatShortDate(iso)}`;
</script>

<template>
  <div class="training">
    <header class="page-head">
      <div>
        <h1>Entrenos</h1>
        <p class="muted">{{ stale ? 'Cargando…' : formState }}</p>
      </div>
      <Segmented v-model="range" :options="RANGES" label="Periodo" />
    </header>

    <div v-if="loadError" class="card card-pad load-error" role="alert">
      <p>No se han podido cargar tus datos ({{ loadError.message }}).</p>
      <button class="btn" @click="retry">Reintentar</button>
    </div>

    <template v-if="stale">
      <section class="tiles" aria-busy="true" aria-label="Cargando entrenos">
        <div v-for="n in 4" :key="n" class="card tile tile-skeleton">
          <Skeleton width="70%" height="10px" />
          <Skeleton width="40%" height="28px" />
          <Skeleton width="80%" height="10px" />
        </div>
      </section>
      <CardSkeleton chart="220px" />
    </template>

    <section v-else-if="last" class="tiles">
      <div class="card tile">
        <span class="section-label"
          ><span class="dot" style="background: var(--sleep)" /> Fitness · CTL</span
        >
        <strong>{{ fmtInt(last.ctl) }}</strong>
        <p class="muted">Carga media de 6 semanas</p>
      </div>
      <div class="card tile">
        <span class="section-label"
          ><span class="dot" style="background: var(--activity)" /> Fatiga · ATL</span
        >
        <strong>{{ fmtInt(last.atl) }}</strong>
        <p class="muted">Carga media de 7 días</p>
      </div>
      <div class="card tile">
        <span class="section-label">Forma · TSB</span>
        <strong>{{ fmtSigned(last.tsb) }}</strong>
        <p class="muted">Fitness menos fatiga</p>
      </div>
      <div class="card tile">
        <span class="section-label">Esta semana</span>
        <strong>{{ fmtDuration(thisWeek.minutes) }}</strong>
        <p class="muted">
          {{ thisWeek.sessions }} {{ thisWeek.sessions === 1 ? 'sesión' : 'sesiones' }} ·
          {{ thisWeek.tss }} TSS
        </p>
      </div>
    </section>

    <ChartCard
      v-if="last && !stale"
      title="Fitness y fatiga"
      subtitle="Modelo de carga (PMC) a partir del TSS de cada entreno."
      :table="pmcTable"
    >
      <template #legend>
        <span><span class="dot" style="background: var(--sleep)" />Fitness</span>
        <span><span class="dot" style="background: var(--activity)" />Fatiga</span>
      </template>
      <LineChart
        :labels="labels"
        :series="[
          {
            id: 'ctl',
            label: 'Fitness',
            color: 'var(--sleep)',
            values: days.map((d) => round(d.load?.ctl)),
            area: true,
          },
          {
            id: 'atl',
            label: 'Fatiga',
            color: 'var(--activity)',
            values: days.map((d) => round(d.load?.atl)),
          },
        ]"
        :height="220"
        zero
      />
      <div class="tsb">
        <span class="section-label">Forma (TSB)</span>
        <BarChart
          :labels="labels"
          :series="[
            {
              id: 'tsb',
              label: 'Forma',
              color: 'var(--diverge-pos)',
              values: days.map((d) => round(d.load?.tsb)),
            },
          ]"
          :color-for="(v) => (v >= 0 ? 'var(--diverge-pos)' : 'var(--diverge-neg)')"
          :height="110"
          :format="(v) => fmtSigned(v)"
          :tick-format="(v) => fmtSigned(v)"
        />
      </div>
    </ChartCard>

    <div v-if="listStale" class="columns" aria-busy="true">
      <CardSkeleton chart="200px" />
      <CardSkeleton :rows="6" />
    </div>

    <div v-else class="columns">
      <ChartCard
        v-if="weeks.length"
        title="Volumen semanal"
        subtitle="Horas de entreno por semana."
      >
        <BarChart
          :labels="weeks.map((w) => formatShortDate(w.week))"
          :tooltip-labels="
            weeks.map(
              (w) =>
                `Semana del ${formatShortDate(w.week)} · ${w.sessions} sesiones · ${w.tss} TSS`,
            )
          "
          :series="[
            {
              id: 'h',
              label: 'Tiempo',
              color: 'var(--activity)',
              values: weeks.map((w) => w.minutes),
            },
          ]"
          :format="fmtDuration"
          :y-ticks="hourTicks(Math.max(...weeks.map((w) => w.minutes)))"
          :tick-format="(v) => `${v / 60}h`"
          :height="200"
        />
      </ChartCard>

      <section class="card activities">
        <header>
          <h2>Actividades</h2>
          <span class="muted">{{ list?.length ?? 0 }} en el periodo</span>
        </header>
        <ul>
          <li v-for="a in (list ?? []).slice(0, shown)" :key="a.id">
            <button class="row" @click="open(a)">
              <span class="sport"><component :is="iconFor(a.icon)" class="icon" /></span>
              <span class="main">
                <strong>{{ a.title }}</strong>
                <span class="muted">{{ dayLabel(a.date) }} · {{ a.sportLabel }}</span>
              </span>
              <span class="cell num"><small>Tiempo</small>{{ fmtDuration(a.minutes) }}</span>
              <span class="cell num hide-sm"><small>Distancia</small>{{ formatDistance(a) }}</span>
              <span class="cell num hide-sm"
                ><small>{{ a.paceSecPerKm ? 'Ritmo' : 'Potencia' }}</small
                >{{ formatPace(a) }}</span
              >
              <span class="cell num"><small>FC</small>{{ a.avgHr ?? '—' }}</span>
              <span class="cell num"><small>TSS</small>{{ a.tss ?? '—' }}</span>
              <ChevronRight class="icon chevron" />
            </button>
          </li>
        </ul>
        <button v-if="(list?.length ?? 0) > shown" class="btn btn-ghost more" @click="shown += 20">
          Ver más
        </button>
      </section>
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

.training {
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

.tiles {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.tile {
  display: grid;
  gap: 2px;
  padding: 14px 16px;
}

.tile-skeleton {
  gap: 10px;
}

.tile .section-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.tile strong {
  font-size: 26px;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.tile p {
  font-size: 12px;
}

.tsb {
  margin-top: 18px;
  display: grid;
  gap: 6px;
}

.columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr);
  gap: 16px;
  align-items: start;
}

.activities {
  padding: 18px 8px 8px;
}

.activities header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0 12px 10px;
}

.activities header .muted {
  font-size: 12px;
}

.activities ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) repeat(5, auto) 16px;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.row:hover {
  background: var(--surface-hover);
}

.sport {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  color: var(--activity);
  background: color-mix(in srgb, var(--activity) 12%, transparent);
}

.main {
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

.more {
  width: 100%;
  margin-top: 4px;
  color: var(--text-2);
}

@media (max-width: 1180px) {
  .columns {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 860px) {
  .tiles {
    grid-template-columns: repeat(2, 1fr);
  }

  .page-head {
    flex-direction: column;
    align-items: flex-start;
  }

  /* El nombre a todo el ancho y las cifras en una fila debajo (no caben al lado) */
  .row {
    grid-template-columns: 34px repeat(3, minmax(0, 1fr));
    column-gap: 12px;
    row-gap: 6px;
    padding: 10px 8px;
  }

  .sport {
    grid-row: span 2;
    align-self: start;
  }

  .main {
    grid-column: 2 / -1;
  }

  .cell {
    justify-items: start;
    min-width: 0;
  }

  .hide-sm,
  .chevron {
    display: none;
  }
}
</style>
