<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Plus, Sparkles } from '@lucide/vue';
import DateNav from '../components/day/DateNav.vue';
import EventTimeline from '../components/day/EventTimeline.vue';
import EventDrawer from '../components/day/EventDrawer.vue';
import QuickAddModal from '../components/day/QuickAddModal.vue';
import VitalTile from '../components/day/VitalTile.vue';
import ScoreRing from '../components/charts/ScoreRing.vue';
import DayStrip from '../components/charts/DayStrip.vue';
import BarChart from '../components/charts/BarChart.vue';
import Hypnogram from '../components/charts/Hypnogram.vue';
import Sparkline from '../components/charts/Sparkline.vue';
import StatusPill from '../components/ui/StatusPill.vue';
import Meter from '../components/ui/Meter.vue';
import Delta from '../components/ui/Delta.vue';
import { STAGE_COLOR, STAGE_LABEL } from '../components/charts/colors.js';
import { useAsync } from '../composables/useAsync.js';
import Skeleton from '../components/ui/Skeleton.vue';
import { useToast } from '../composables/useToast.js';
import { clearTimelineCache, fetchDay, fetchEngine, fetchSummaries } from '../services/twin.js';
import { documentDay, documentEvent, withDocuments } from '../services/timeline.js';
import { fmtDocDate, listDocuments, movedFrom } from '../services/clinical.js';
import { setBadge } from '../services/push.js';
import { formatShortDate, todayISO } from '../lib/dates.js';
import { fmtDec, fmtDuration, fmtInt, fmtSigned, fmtCompact } from '../lib/format.js';

const route = useRoute();
const router = useRouter();
const date = computed(() => route.params.date || todayISO());

const {
  data: day,
  error: dayError,
  loading: dayLoading,
  reload: reloadDay,
} = useAsync(date, fetchDay);
const { data: history, reload: reloadHistory } = useAsync(date, (d) => fetchSummaries(30, d));
// Objetivos de comida del motor (gasto real con tu comida y tu báscula, no las kcal del reloj)
const engine = ref(null);
const loadEngine = () =>
  fetchEngine()
    .then((state) => (engine.value = state?.ready ? state : null))
    .catch(() => (engine.value = null));
loadEngine();
const targets = computed(() => engine.value?.targets ?? null);
const CONFIDENCE_TEXT = {
  none: 'por fórmula, aún sin tus datos',
  low: 'confianza baja',
  medium: 'confianza media',
  high: 'confianza alta',
};
const retry = () => {
  reloadDay();
  reloadHistory();
};
// El día que se ve es el pedido (si falla, lo que hay en pantalla es de otro día)
const stale = computed(() => day.value && day.value.date !== date.value);
// Primera carga o cambio de día: el esqueleto, no el día anterior
const skeleton = computed(
  () => !dayError.value && (!day.value || (dayLoading.value && stale.value)),
);
const toast = useToast();

// --- Informes de Clínica: salen en su día, también los que faltan por revisar ----------------

const POLL_MS = 3000;
const documents = ref([]);
let pollTimer;

const dayRoute = (value, query) =>
  value === todayISO() ? { name: 'day', query } : { name: 'day', params: { date: value }, query };

/** Si un informe ha ido a otro día que el que se ve (su fecha es otra), se avisa con enlace. */
function noticeMoved(doc) {
  const from = movedFrom(doc);
  if (!from || doc.date === date.value) return;
  // Si está abierto en el lateral, ya lo dice ahí
  if (drawerOpen.value && selected.value?.clinical?.documentId === doc.id) return;
  toast.show(`Es del ${fmtDocDate(doc.date)}: lo hemos puesto en ese día`, 'neutral', {
    action: {
      label: `Ir al ${formatShortDate(doc.date)}`,
      to: dayRoute(doc.date, { event: `clinical-${doc.id}` }),
    },
  });
}

async function loadDocuments({ quiet } = {}) {
  clearTimeout(pollTimer);
  try {
    const before = new Map(documents.value.map((d) => [d.id, d.status]));
    documents.value = await listDocuments({ quiet });
    // El número del icono de la app: informes leídos que esperan tu revisión
    setBadge(documents.value.filter((d) => d.status === 'review').length);
    // Los que se acaban de leer: si eran de otro día, al timeline de ese día
    for (const d of documents.value) {
      if (before.get(d.id) === 'processing' && d.status !== 'processing') noticeMoved(d);
    }
  } catch {
    // Sin Clínica el día se ve igual
  }
  if (documents.value.some((d) => d.status === 'processing')) {
    pollTimer = setTimeout(() => loadDocuments({ quiet: true }), POLL_MS);
  }
}
loadDocuments();
onBeforeUnmount(() => clearTimeout(pollTimer));

// Al volver a la app (estaba en segundo plano: la PWA puede seguir abierta horas) se vuelve a
// pedir el día, sin esqueleto: lo que hayas apuntado por el bot sale sin tener que cerrarla
let hiddenAt = null;
function onVisibility() {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    return;
  }
  if (hiddenAt && Date.now() - hiddenAt > 30_000) {
    clearTimelineCache();
    reloadDay();
    reloadHistory();
    loadEngine();
    loadDocuments({ quiet: true });
  }
  hiddenAt = null;
}
document.addEventListener('visibilitychange', onVisibility);
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisibility));

const events = computed(() => withDocuments(day.value?.events ?? [], documents.value, date.value));

const selected = ref(null);
const drawerOpen = ref(false);
const addOpen = ref(false);

function select(event) {
  selected.value = event;
  drawerOpen.value = true;
}

// /day/2026-10-12?event=workout-2026-10-12 abre ese evento (enlaces desde Entrenos y Clínica)
watch(
  () => [day.value, route.query.event, events.value.length],
  ([value, id]) => {
    const target = id && value && events.value.find((e) => e.id === id);
    if (target && selected.value?.id !== id) select(target);
  },
);

// /day?add=report abre Registrar para subir un informe (desde Clínica)
const addKind = ref(null);
watch(
  () => route.query.add,
  (kind) => {
    if (!kind) return;
    addKind.value = kind;
    addOpen.value = true;
    router.replace({ query: { ...route.query, add: undefined } });
  },
  { immediate: true },
);

function closeDrawer() {
  drawerOpen.value = false;
  if (route.query.event) router.replace({ query: { ...route.query, event: undefined } });
}

function changeDate(value) {
  router.push(dayRoute(value));
}

/** Registrar ya lo ha guardado en la API: se vuelve a pedir el día para que salga. */
function addEntry({ date: entryDate, subtitle }) {
  loadEngine();
  if (entryDate === date.value) {
    reloadDay();
    reloadHistory();
    return toast.show(`Guardado: ${subtitle}`);
  }
  toast.show(`Guardado el ${formatShortDate(entryDate)}: ${subtitle}`, 'neutral', {
    action: { label: 'Ver ese día', to: dayRoute(entryDate) },
  });
}

/** Un informe recién subido: sale en el día (leyéndose) y se abre en el lateral. */
async function uploaded({ document, created }) {
  await loadDocuments();
  const doc = documents.value.find((d) => d.id === document.id) ?? document;
  const docDay = documentDay(doc);
  if (!created) {
    toast.show('Ese PDF ya estaba subido');
    if (docDay !== date.value) {
      router.push(dayRoute(docDay, { event: `clinical-${doc.id}` }));
      return;
    }
  }
  select(documentEvent(doc, docDay));
}

/** Guardado, confirmado o releído desde el lateral: se recarga el día (y la fecha puede cambiar). */
async function documentChanged(doc, { quiet = false } = {}) {
  clearTimelineCache();
  reloadDay();
  await loadDocuments();
  if (!quiet && doc?.extraction?.date && doc.extraction.date !== date.value) {
    toast.show(`Está en el ${fmtDocDate(doc.extraction.date)}`, 'neutral', {
      action: {
        label: `Ir al ${formatShortDate(doc.extraction.date)}`,
        to: dayRoute(doc.extraction.date, { event: `clinical-${doc.id}` }),
      },
    });
  }
}

async function documentDeleted() {
  closeDrawer();
  clearTimelineCache();
  reloadDay();
  await loadDocuments();
}

// --- Puntuaciones -----------------------------------------------------------------------------

const recovery = computed(() => {
  const v = day.value?.recovery;
  if (v == null) return { tone: 'neutral', label: 'Sin calcular', color: 'var(--grid)' };
  if (v >= 67) return { tone: 'good', label: 'Alta', color: 'var(--good)' };
  if (v >= 34) return { tone: 'warning', label: 'Media', color: 'var(--warning)' };
  return { tone: 'critical', label: 'Baja', color: 'var(--critical)' };
});

const insight = computed(() => {
  const d = day.value;
  if (!d) return '';
  const hrvValues = (history.value ?? []).map((s) => s.hrv).filter((v) => v != null);
  const hrvAvg = hrvValues.reduce((a, b) => a + b, 0) / (hrvValues.length || 1) || d.hrv;
  const hrvPct = Math.round(((d.hrv - hrvAvg) / hrvAvg) * 100);
  const parts = [];
  if (d.hrv != null)
    parts.push(
      hrvPct === 0
        ? `VFC de ${d.hrv} ms, en tu media`
        : `VFC de ${d.hrv} ms, un ${Math.abs(hrvPct)} % por ${hrvPct > 0 ? 'encima' : 'debajo'} de tu media`,
    );
  if (d.rhr != null) parts.push(`FC en reposo de ${d.rhr} ppm`);
  const sleepGap = d.sleep.need - d.sleep.minutes;
  if (d.sleep.minutes && sleepGap > 30) parts.push(`te faltaron ${fmtDuration(sleepGap)} de sueño`);
  if (!parts.length) parts.push('Sin datos del reloj este día');
  // El consejo sale de la recuperación: sin ella, solo los datos
  const advice =
    d.recovery == null
      ? ''
      : d.recovery >= 67
        ? ' Buen día para meter intensidad.'
        : d.recovery >= 34
          ? ' Mejor volumen suave que series.'
          : ' Hoy toca descanso o algo muy suave.';
  return `${parts.join(', ')}.${advice}`;
});

// --- Constantes (tendencia de 30 días) ----------------------------------------------------------

const series = (key) =>
  (history.value ?? []).map((s) => (typeof key === 'function' ? key(s) : s[key]));
const vitals = computed(() => {
  const d = day.value;
  if (!d) return [];
  const avg = (key) => {
    const v = series(key).filter((x) => x != null);
    return v.reduce((a, b) => a + b, 0) / (v.length || 1);
  };
  // Sin dato ese día no hay comparación
  const vs = (key) => (d[key] == null ? null : d[key] - avg(key));
  return [
    {
      label: 'VFC',
      value: fmtInt(d.hrv),
      unit: 'ms',
      delta: vs('hrv'),
      goodWhen: 'up',
      trend: series('hrv'),
    },
    {
      label: 'FC en reposo',
      value: fmtInt(d.rhr),
      unit: 'ppm',
      delta: vs('rhr'),
      goodWhen: 'down',
      trend: series('rhr'),
    },
    {
      label: 'SpO2',
      value: fmtDec(d.spo2, 1),
      unit: '%',
      delta: vs('spo2'),
      deltaDigits: 1,
      goodWhen: 'up',
      trend: series('spo2'),
    },
    {
      label: 'Frec. respiratoria',
      value: fmtDec(d.respRate, 1),
      unit: 'rpm',
      delta: vs('respRate'),
      deltaDigits: 1,
      goodWhen: 'none',
      trend: series('respRate'),
    },
    {
      label: 'Temp. de la piel',
      value: fmtSigned(d.skinTemp, 1),
      unit: '°C',
      delta: null,
      goodWhen: 'none',
      trend: series('skinTemp'),
    },
    // Forma cardiovascular (la estima el reloj): va con las constantes, no con la báscula
    {
      label: 'VO2 máx.',
      value: fmtDec(d.vo2max, 1),
      unit: 'mL/kg/min',
      delta: vs('vo2max'),
      deltaDigits: 1,
      goodWhen: 'up',
      trend: series('vo2max'),
    },
  ];
});

// --- Cuerpo -----------------------------------------------------------------------------------

const body = computed(() => {
  const list = history.value ?? [];
  const weighed = list.filter((s) => s.weight != null);
  const latest = weighed.at(-1);
  if (!latest) return null;
  return {
    ...latest,
    isToday: latest.date === date.value,
    delta: latest.weight - weighed[0].weight,
    trend: list.map((s) => s.weight),
  };
});

const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const hourLabels = hours.map((h) => `${h}:00 – ${h}:59`);
</script>

<template>
  <div class="today">
    <header class="page-head">
      <DateNav :date="date" @change="changeDate" />
      <RouterLink
        :to="{ name: 'coach', query: { date } }"
        class="btn ask"
        title="Pregúntale al coach por este día"
      >
        <Sparkles class="icon" />
        <span class="label">Pregúntale</span>
      </RouterLink>
      <button class="btn btn-primary" @click="addOpen = true">
        <Plus class="icon" />
        Registrar
      </button>
    </header>

    <!-- Si falla no se enseña nada inventado: el error y un reintento -->
    <div v-if="dayError" class="card card-pad load-error" role="alert">
      <p>
        No se han podido cargar los datos de este día<span v-if="dayError.message">
          ({{ dayError.message }})</span
        >.
      </p>
      <button class="btn" :disabled="dayLoading" @click="retry">
        {{ dayLoading ? 'Cargando…' : 'Reintentar' }}
      </button>
    </div>

    <div v-if="skeleton" class="body" aria-busy="true" aria-label="Cargando el día">
      <section class="scores">
        <div v-for="n in 3" :key="n" class="card score">
          <Skeleton circle height="116px" />
          <div class="score-text score-text-skeleton">
            <Skeleton width="55%" height="10px" />
            <Skeleton width="45%" height="20px" radius="10px" />
            <Skeleton width="85%" />
          </div>
        </div>
      </section>
      <section class="vitals">
        <div v-for="n in 6" :key="n" class="card vital-skeleton">
          <Skeleton width="60%" height="10px" />
          <Skeleton width="45%" height="26px" />
          <Skeleton width="70%" height="10px" />
          <Skeleton height="28px" />
        </div>
      </section>
      <section class="card card-pad strip-card">
        <header class="strip-head"><h2>Tu día</h2></header>
        <Skeleton height="120px" radius="8px" />
      </section>
      <div class="columns">
        <section class="card card-pad">
          <header class="col-head"><h2>Timeline</h2></header>
          <div class="rows-skeleton">
            <div v-for="n in 5" :key="n" class="row-skeleton">
              <Skeleton width="44px" />
              <Skeleton circle height="28px" />
              <Skeleton :width="`${40 + ((n * 17) % 40)}%`" />
            </div>
          </div>
        </section>
        <div class="side">
          <section v-for="title in ['Actividad', 'Nutrición']" :key="title" class="card card-pad">
            <header class="col-head">
              <h2>{{ title }}</h2>
            </header>
            <div class="rows-skeleton">
              <Skeleton width="40%" height="28px" />
              <Skeleton height="8px" radius="4px" />
              <Skeleton width="80%" />
            </div>
          </section>
        </div>
      </div>
    </div>

    <div v-else-if="day && !(dayError && stale)" class="body">
      <!-- Puntuaciones -->
      <section class="scores">
        <div class="card score">
          <ScoreRing :value="day.recovery" :color="recovery.color" unit="%" label="Recuperación" />
          <div class="score-text">
            <span class="section-label">Recuperación</span>
            <StatusPill :tone="recovery.tone" :label="recovery.label" />
            <p class="secondary">VFC {{ fmtInt(day.hrv) }} ms · reposo {{ fmtInt(day.rhr) }} ppm</p>
          </div>
        </div>
        <div class="card score">
          <ScoreRing :value="day.sleep.score" color="var(--sleep)" label="Sueño" />
          <div class="score-text">
            <span class="section-label">Sueño</span>
            <template v-if="day.sleep.minutes != null">
              <strong class="big">{{ fmtDuration(day.sleep.minutes) }}</strong>
              <p class="secondary">
                de {{ fmtDuration(day.sleep.need) }} · eficiencia {{ day.sleep.efficiency }} %
              </p>
            </template>
            <p v-else class="secondary">Sin noche registrada</p>
          </div>
        </div>
        <div class="card score">
          <ScoreRing :value="day.load?.tss" :max="150" color="var(--activity)" label="Carga" />
          <div class="score-text">
            <span class="section-label">Carga del día · TSS</span>
            <template v-if="day.load">
              <strong class="big">{{ day.load.tss ? `${day.load.tss} TSS` : 'Descanso' }}</strong>
              <p class="secondary">
                Forma {{ fmtSigned(day.load.tsb) }} · fitness {{ fmtInt(day.load.ctl) }}
              </p>
            </template>
            <p v-else class="secondary">Sin datos de intervals.icu este día</p>
          </div>
        </div>
        <p class="insight">{{ insight }}</p>
      </section>

      <!-- Constantes -->
      <section class="vitals">
        <VitalTile v-for="v in vitals" :key="v.label" v-bind="v" />
      </section>

      <!-- Franja de 24 h -->
      <section class="card card-pad strip-card">
        <header class="strip-head">
          <h2>Tu día</h2>
          <div class="legend">
            <span><span class="line-key" />Frecuencia cardiaca</span>
            <span><span class="dot" style="background: var(--sleep)" />Sueño</span>
            <span><span class="dot" style="background: var(--activity)" />Actividad</span>
            <span><span class="dot" style="background: var(--nutrition)" />Nutrición</span>
            <span><span class="dot" style="background: var(--text-2)" />Otros</span>
          </div>
        </header>
        <DayStrip
          :hr="day.hr"
          :events="events"
          :until="day.until"
          :selected-id="drawerOpen ? selected?.id : null"
          @select="select"
        />
      </section>

      <div class="columns">
        <section class="card card-pad">
          <header class="col-head">
            <h2>Timeline</h2>
            <span class="muted">{{ events.length }} eventos</span>
          </header>
          <EventTimeline
            :events="events"
            :selected-id="drawerOpen ? selected?.id : null"
            @select="select"
          />
        </section>

        <div class="side">
          <section class="card card-pad">
            <header class="col-head">
              <h2>Actividad</h2>
            </header>
            <p v-if="day.steps == null && day.activeKcal == null" class="secondary">
              Sin datos de actividad este día.
            </p>
            <template v-else>
              <div class="headline">
                <strong class="big">{{ fmtInt(day.steps) }}</strong>
                <span class="muted">pasos de 10.000</span>
              </div>
              <Meter :value="day.steps ?? 0" :max="10000" color="var(--activity)" />
              <dl class="stats">
                <div>
                  <dt>Distancia</dt>
                  <dd>{{ fmtDec(day.distanceKm, 1) }} km</dd>
                </div>
                <div>
                  <dt>Kcal activas</dt>
                  <dd>{{ fmtInt(day.activeKcal) }}</dd>
                </div>
                <div>
                  <dt>Pisos</dt>
                  <dd>{{ fmtInt(day.floors) }}</dd>
                </div>
              </dl>
              <BarChart
                :labels="hours"
                :tooltip-labels="hourLabels"
                :series="[
                  {
                    id: 'steps',
                    label: 'Pasos',
                    color: 'var(--activity)',
                    values: day.stepsByHour,
                  },
                ]"
                :height="110"
                :x-tick-every="6"
                :format="fmtInt"
                :tick-format="fmtCompact"
                integer
              />
            </template>
          </section>

          <section class="card card-pad">
            <header class="col-head">
              <h2>Nutrición</h2>
              <span
                v-if="targets"
                class="muted"
                :title="`Gasto real ${fmtInt(engine.expenditure.kcal)} kcal (${CONFIDENCE_TEXT[engine.expenditure.confidence]})`"
                >objetivo {{ fmtInt(targets.kcal) }} kcal</span
              >
            </header>
            <p v-if="day.nutrition.kcal == null" class="secondary nutrition-empty">
              Sin comidas apuntadas este día.
            </p>
            <template v-else>
              <div class="headline">
                <strong class="big">{{ fmtInt(day.nutrition.kcal) }}</strong>
                <span v-if="targets" class="muted"
                  >kcal · quedan {{ fmtInt(Math.max(0, targets.kcal - day.nutrition.kcal)) }}</span
                >
                <span v-else class="muted">kcal</span>
              </div>
              <Meter
                v-if="targets"
                :value="day.nutrition.kcal"
                :max="targets.kcal"
                color="var(--nutrition)"
              />
              <dl class="stats">
                <div>
                  <dt>Proteína</dt>
                  <dd>
                    {{ day.nutrition.protein }}
                    <small>/ {{ targets?.proteinG ?? day.nutrition.proteinTarget }} g</small>
                  </dd>
                </div>
                <div>
                  <dt>Hidratos</dt>
                  <dd>
                    {{ day.nutrition.carbs }} <small>/ {{ targets?.carbsG ?? '—' }} g</small>
                  </dd>
                </div>
                <div>
                  <dt>Grasa</dt>
                  <dd>
                    {{ day.nutrition.fat }} <small>/ {{ targets?.fatG ?? '—' }} g</small>
                  </dd>
                </div>
              </dl>
            </template>
            <div class="water">
              <span class="section-label">Agua</span>
              <span class="num"
                >{{
                  day.nutrition.waterMl == null ? '—' : fmtDec(day.nutrition.waterMl / 1000, 1)
                }}
                / {{ fmtDec(day.nutrition.waterTargetMl / 1000, 1) }} L</span
              >
            </div>
            <Meter
              :value="day.nutrition.waterMl ?? 0"
              :max="day.nutrition.waterTargetMl"
              color="var(--text-2)"
              :height="4"
            />
          </section>

          <section v-if="body" class="card card-pad">
            <header class="col-head">
              <h2>Cuerpo</h2>
              <span class="muted">{{
                body.isToday
                  ? 'Pesaje de hoy'
                  : `Último pesaje: ${body.date.slice(8)}/${body.date.slice(5, 7)}`
              }}</span>
            </header>
            <div class="headline">
              <strong class="big">{{ fmtDec(body.weight, 1) }}</strong>
              <span class="muted">kg</span>
              <Delta
                :value="body.delta"
                :digits="1"
                unit=" kg"
                good-when="none"
                versus="en 30 días"
              />
            </div>
            <Sparkline :values="body.trend" color="var(--text)" :height="36" />
            <dl class="stats">
              <div>
                <dt>Grasa</dt>
                <dd>{{ fmtDec(body.bodyFat, 1) }} <small>%</small></dd>
              </div>
              <div>
                <dt>Músculo</dt>
                <dd>{{ fmtDec(body.muscle, 1) }} <small>kg</small></dd>
              </div>
            </dl>
          </section>

          <section class="card card-pad">
            <header class="col-head">
              <h2>Sueño</h2>
              <span class="muted">{{ fmtDuration(day.sleep.minutes) }}</span>
            </header>
            <template v-if="day.sleepDetail.stages.length">
              <Hypnogram :stages="day.sleepDetail.stages" :height="120" />
              <div class="legend stage-legend">
                <span v-for="k in ['deep', 'light', 'rem', 'awake']" :key="k">
                  <span class="dot" :style="{ background: STAGE_COLOR[k] }" />
                  {{ STAGE_LABEL[k] }} {{ fmtDuration(day.sleep[k]) }}
                </span>
              </div>
            </template>
            <p v-else class="muted">Sin noche registrada (¿no dormiste con el reloj?).</p>
          </section>
        </div>
      </div>
    </div>

    <EventDrawer
      :event="selected"
      :open="drawerOpen"
      @close="closeDrawer"
      @changed="documentChanged"
      @deleted="documentDeleted"
    />
    <QuickAddModal
      :open="addOpen"
      :date="date"
      :initial-kind="addKind"
      @close="
        addOpen = false;
        addKind = null;
      "
      @add="addEntry"
      @uploaded="uploaded"
    />
  </div>
</template>

<style scoped>
.today {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  max-width: 1280px;
  margin: 0 auto;
}

.body {
  display: contents;
}

/* Esqueleto mientras carga el día */
.score-text-skeleton {
  flex: 1;
  min-width: 0;
  width: 100%;
}

.vital-skeleton {
  display: grid;
  gap: 10px;
  padding: 16px;
}

.rows-skeleton {
  display: grid;
  gap: 16px;
}

.row-skeleton {
  display: flex;
  align-items: center;
  gap: 12px;
}

.load-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--critical-text);
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 8px;
}

.page-head .ask {
  margin-left: auto;
}

.scores {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.score {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 18px 20px;
}

.score-text {
  display: grid;
  justify-items: start;
  gap: 6px;
  min-width: 0;
}

.score-text p {
  font-size: 12px;
}

.big {
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.insight {
  grid-column: 1 / -1;
  padding: 2px 4px;
  color: var(--text-2);
  font-size: 14px;
}

.vitals {
  display: grid;
  /* Seis en dos filas de tres, alineadas con los anillos de arriba */
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.strip-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-bottom: 8px;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  font-size: 12px;
  color: var(--text-2);
}

.legend > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.line-key {
  width: 14px;
  height: 2px;
  border-radius: 1px;
  background: var(--hr-line);
}

.columns {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.side {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.side > *,
.columns > * {
  min-width: 0;
}

.col-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.col-head .muted {
  font-size: 12px;
}

.headline {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.headline .muted {
  font-size: 13px;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin: 14px 0;
}

.stats dt {
  font-size: 12px;
  color: var(--muted);
}

.stats dd {
  margin: 2px 0 0;
  font-weight: 600;
  font-size: 15px;
}

.stats small {
  font-weight: 400;
  color: var(--muted);
  font-size: 12px;
}

.nutrition-empty {
  margin-bottom: 14px;
}

.water {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 6px;
}

.stage-legend {
  margin-top: 10px;
}

@media (max-width: 1180px) {
  .columns {
    grid-template-columns: 1fr;
  }

  .side {
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  }
}

@media (max-width: 860px) {
  /* Cabecera: el título primero y las flechas a su derecha; "Pregúntale" se queda en icono */
  .page-head {
    gap: 8px;
  }

  .page-head .ask {
    width: 34px;
    padding: 0;
  }

  .page-head .ask .label {
    display: none;
  }

  /* Los tres anillos en fila, como un resumen de un vistazo */
  .scores {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .score {
    flex-direction: column;
    gap: 10px;
    padding: 14px 8px 12px;
    text-align: center;
  }

  .score :deep(.ring) {
    width: 76px !important;
    height: 76px !important;
  }

  .score > .skeleton {
    width: 76px !important;
    height: 76px !important;
  }

  .score :deep(.ring svg) {
    width: 100%;
    height: 100%;
  }

  .score :deep(.ring .value) {
    font-size: 22px;
  }

  .score-text {
    justify-items: center;
    gap: 4px;
  }

  .score-text .section-label {
    font-size: 11px;
  }

  .score-text p {
    font-size: 11px;
    line-height: 1.3;
  }

  .big {
    font-size: 16px;
  }

  .insight {
    padding: 2px;
    font-size: 13px;
  }

  .vitals {
    grid-template-columns: repeat(2, 1fr);
  }

  /* Con un número impar, el último no se queda solo a media fila */
  .vitals > :last-child:nth-child(odd) {
    grid-column: 1 / -1;
  }

  .page-head .btn-primary {
    position: fixed;
    right: 16px;
    bottom: calc(80px + env(safe-area-inset-bottom));
    z-index: 20;
    height: 44px;
    border-radius: 999px;
    box-shadow: var(--shadow);
  }
}
</style>
