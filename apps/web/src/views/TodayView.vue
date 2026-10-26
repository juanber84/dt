<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Plus, Sparkles } from '@lucide/vue';
import DateNav from '../components/day/DateNav.vue';
import EventTimeline from '../components/day/EventTimeline.vue';
import EventDrawer from '../components/day/EventDrawer.vue';
import QuickAddModal from '../components/day/QuickAddModal.vue';
import VitalTile from '../components/day/VitalTile.vue';
import PeriodBanner from '../components/today/PeriodBanner.vue';
import CreatineBanner from '../components/today/CreatineBanner.vue';
import TodaySkeleton from '../components/today/TodaySkeleton.vue';
import ScoreCards from '../components/today/ScoreCards.vue';
import DayStripCard from '../components/today/DayStripCard.vue';
import ActivityCard from '../components/today/ActivityCard.vue';
import NutritionCard from '../components/today/NutritionCard.vue';
import BodyCard from '../components/today/BodyCard.vue';
import SleepCard from '../components/today/SleepCard.vue';
import SupplementsCard from '../components/today/SupplementsCard.vue';
import { useAsync } from '../composables/useAsync.js';
import { useToast } from '../composables/useToast.js';
import { clearTimelineCache, fetchDay, fetchEngine, fetchSummaries } from '../services/twin.js';
import { documentDay, documentEvent, withDocuments } from '../services/timeline.js';
import { bodyOf, vitalsOf } from '../services/today.js';
import { fmtDocDate, listDocuments, movedFrom } from '../services/clinical.js';
import { setBadge } from '../services/push.js';
import { listSupplements } from '../services/supplements.js';
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
// Un periodo en curso o recién acabado (fuera de casa, enfermo): solo en el día de hoy, que es al
// que se refiere el estado del motor
const period = computed(() =>
  engine.value?.period && date.value === todayISO() ? engine.value.period : null,
);
// La creatina recién empezada o dejada: el peso mueve agua (también solo en hoy)
const creatine = computed(() =>
  engine.value?.creatine && date.value === todayISO() ? engine.value.creatine : null,
);
// Los suplementos habituales (Ajustes), para marcarlos en el día (null: sin cargar o sin API)
const supplements = ref(null);
const loadSupplements = () =>
  listSupplements()
    .then((list) => (supplements.value = list))
    .catch(() => (supplements.value = null));
loadSupplements();
/** Una toma marcada o deshecha: el día de nuevo (`done` suelta el chip cuando ya está). */
async function supplementsChanged(done) {
  await Promise.all([reloadDay(), reloadHistory()]);
  done();
}
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
    loadSupplements();
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

// Constantes y cuerpo (las puntuaciones las calcula ScoreCards)
const vitals = computed(() => vitalsOf(day.value, history.value ?? []));
const body = computed(() => bodyOf(history.value ?? [], date.value));
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

    <PeriodBanner v-if="period" :period="period" />
    <CreatineBanner v-if="creatine" :notice="creatine" />

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
      <TodaySkeleton />
    </div>

    <div v-else-if="day && !(dayError && stale)" class="body">
      <ScoreCards :day="day" :history="history ?? []" />

      <!-- Constantes -->
      <section class="vitals">
        <VitalTile v-for="v in vitals" :key="v.label" v-bind="v" />
      </section>

      <DayStripCard
        :hr="day.hr"
        :events="events"
        :until="day.until"
        :selected-id="drawerOpen ? selected?.id : null"
        @select="select"
      />

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
          <ActivityCard :day="day" />
          <NutritionCard :day="day" :engine="engine" />
          <SupplementsCard
            v-if="supplements"
            :supplements="supplements"
            :date="date"
            :events="events"
            @changed="supplementsChanged"
          />
          <BodyCard v-if="body" :body="body" />
          <SleepCard :day="day" />
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

<style scoped src="../components/today/layout.css"></style>
<style scoped src="../components/today/card.css"></style>
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
