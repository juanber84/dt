<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  CalendarClock,
  Info,
  Pencil,
  RotateCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from '@lucide/vue';
import StatusPill from '../ui/StatusPill.vue';
import ClinicalSummary from './ClinicalSummary.vue';
import ClinicalFields from './ClinicalFields.vue';
import ClinicalValues from './ClinicalValues.vue';
import HolterHours from './HolterHours.vue';
import { useConfirm } from '../../composables/useConfirm.js';
import { useToast } from '../../composables/useToast.js';
import {
  categoryOf,
  chooseMetric,
  confirmDocument,
  deleteDocument,
  documentIssues,
  editItem,
  fmtDocDate,
  getDocument,
  listMetrics,
  metricGroups,
  movedFrom,
  retryDocument,
  saveDocument,
  statusPill,
} from '../../services/clinical.js';

/**
 * Un documento de Clínica en el lateral del día: se lee, se revisa (corrigiendo lo que haga
 * falta) y se confirma. Ya confirmado se ve en limpio y se puede volver a editar. Aquí, la carga,
 * el guardado y los avisos; lo que se ve, en ClinicalSummary (en limpio) y ClinicalFields,
 * ClinicalValues y HolterHours (al revisar).
 */
const props = defineProps({
  documentId: { type: String, required: true },
});
// loaded: el documento tal como está (para la cabecera); changed: guardado/confirmado/releído
// (el día se recarga, con `moved` si cambió de día); dirty: hay cambios sin guardar
const emit = defineEmits(['loaded', 'changed', 'deleted', 'dirty']);

const POLL_MS = 2500;
const toast = useToast();
const { ask } = useConfirm();

const doc = ref(null);
const draft = ref(null);
const error = ref(null);
const metrics = ref([]);
const busy = ref(null);
const editing = ref(false);
let timer;

const editable = computed(
  () => doc.value?.status === 'review' || (doc.value?.status === 'confirmed' && editing.value),
);
const dirty = computed(
  () =>
    Boolean(draft.value) && JSON.stringify(draft.value) !== JSON.stringify(doc.value?.extraction),
);
const isTest = computed(() => categoryOf(draft.value?.type) === 'test');
const metricOptions = computed(() => metricGroups(metrics.value));
const issues = computed(() => documentIssues(draft.value, doc.value?.requestedDate));
const moved = computed(() => doc.value && movedFrom(doc.value));

watch(dirty, (value) => emit('dirty', value));

function show(next) {
  doc.value = next;
  draft.value = next.extraction ? structuredClone(next.extraction) : null;
  emit('loaded', next);
}

async function load({ quiet } = {}) {
  clearTimeout(timer);
  try {
    const next = await getDocument(props.documentId, { quiet });
    const wasProcessing = doc.value?.status === 'processing';
    // Mientras se edita no se pisa lo escrito
    if (!dirty.value) show(next);
    else doc.value = { ...next, extraction: doc.value.extraction };
    // Al acabar de leerse el día se recarga, sin avisos: el propio lateral dice dónde ha ido
    error.value = null;
    if (next.status === 'processing') timer = setTimeout(() => load({ quiet: true }), POLL_MS);
    else if (wasProcessing) emit('changed', next, { quiet: true });
  } catch (err) {
    error.value = err;
  }
}

watch(
  () => props.documentId,
  () => {
    editing.value = false;
    doc.value = null;
    draft.value = null;
    load();
  },
  { immediate: true },
);
onBeforeUnmount(() => clearTimeout(timer));
listMetrics()
  .then((list) => (metrics.value = list))
  .catch(() => {});

// Al pasar a informe hace falta su bloque (diagnóstico, reposo...)
watch(
  () => draft.value?.type,
  (type) => {
    if (type === 'report' && draft.value && !draft.value.report) {
      draft.value.report = {
        kind: 'other',
        specialty: null,
        diagnosis: null,
        bodyPart: null,
        recommendations: [],
        restFrom: null,
        restTo: null,
      };
    }
  },
);

function setItem(index, changes) {
  const items = [...draft.value.items];
  items[index] = editItem(items[index], changes);
  draft.value = { ...draft.value, items };
}
function setMetric(index, choice) {
  const items = [...draft.value.items];
  items[index] = chooseMetric(items[index], choice);
  draft.value = { ...draft.value, items };
}
const set = (changes) => (draft.value = { ...draft.value, ...changes });
const setReport = (changes) => (draft.value.report = { ...draft.value.report, ...changes });

async function run(name, fn) {
  busy.value = name;
  try {
    await fn();
  } catch (err) {
    toast.show(err.message, 'critical');
  } finally {
    busy.value = null;
  }
}

const save = () =>
  run('save', async () => {
    const next = await saveDocument(props.documentId, draft.value);
    show(next);
    emit('changed', next);
    toast.show('Cambios guardados');
  });

const confirm = () =>
  run('confirm', async () => {
    const next = await confirmDocument(props.documentId, draft.value);
    show(next);
    editing.value = false;
    emit('changed', next);
    toast.show('Confirmado: ya está en tu timeline', 'good');
  });

const retry = () =>
  run('retry', async () => {
    show(await retryDocument(props.documentId));
    emit('changed', doc.value);
    load();
  });

const cancelEdit = () => {
  show(doc.value);
  editing.value = false;
};

async function remove() {
  const ok = await ask({
    title: 'Borrar informe',
    message:
      doc.value.status === 'confirmed'
        ? 'Se borrará el informe y los datos que añadió a tu timeline.'
        : 'Se borrará el informe.',
    confirmLabel: 'Borrar',
    danger: true,
  });
  if (!ok) return;
  await run('delete', async () => {
    await deleteDocument(props.documentId);
    draft.value = null;
    doc.value = null;
    emit('dirty', false);
    emit('deleted');
    toast.show('Informe borrado');
  });
}
</script>

<template>
  <div class="panel">
    <div v-if="error" class="banner critical" role="alert">
      <TriangleAlert class="icon" />
      <div>
        <strong>No se ha podido cargar el informe</strong>
        <p class="secondary">{{ error.message }}</p>
      </div>
      <button class="btn btn-sm" @click="load">Reintentar</button>
    </div>

    <template v-if="doc">
      <div class="meta">
        <StatusPill v-bind="statusPill(doc.status)" />
        <span v-if="draft?.center" class="muted center">{{ draft.center }}</span>
        <span class="spacer" />
        <button
          v-if="doc.status === 'confirmed' && !editing"
          class="btn btn-sm"
          @click="editing = true"
        >
          <Pencil class="icon icon-sm" /> Editar
        </button>
        <button class="btn btn-sm btn-ghost" :disabled="busy === 'delete'" @click="remove">
          <Trash2 class="icon icon-sm" /> Borrar
        </button>
      </div>

      <!-- La fecha: si el informe es de otro día, va a ese día -->
      <div v-if="moved && draft" class="banner info">
        <CalendarClock class="icon" />
        <p class="secondary">
          Lo subiste desde el {{ fmtDocDate(moved) }}, pero el informe es del
          <strong>{{ fmtDocDate(draft.date) }}</strong
          >: está en ese día.
          <RouterLink
            :to="{
              name: 'day',
              params: { date: draft.date },
              query: { event: `clinical-${doc.id}` },
            }"
            >Ir al {{ fmtDocDate(draft.date) }}</RouterLink
          >
        </p>
      </div>

      <!-- Estado -->
      <div v-if="doc.status === 'processing'" class="banner">
        <RotateCw class="icon spin" />
        <div>
          <strong>Leyendo el informe…</strong>
          <p class="secondary">
            Se saca el texto del PDF, se le quitan tus datos personales y la IA lo lee. Suele tardar
            menos de un minuto; puedes cerrar esto y seguir.
          </p>
        </div>
      </div>
      <div v-else-if="doc.status === 'error'" class="banner critical" role="alert">
        <TriangleAlert class="icon" />
        <div>
          <strong>No se ha podido leer</strong>
          <p class="secondary">{{ doc.error }}</p>
        </div>
        <button class="btn btn-sm" :disabled="busy === 'retry'" @click="retry">
          <RotateCw class="icon icon-sm" /> Reintentar
        </button>
      </div>
      <div v-else-if="doc.status === 'review'" class="banner warning">
        <ShieldCheck class="icon" />
        <div>
          <strong>Revisa y confirma</strong>
          <p class="secondary">
            Cada valor se ha comparado con el texto del informe: los marcados no cuadran. Antes de
            mandarlo a la IA se quitaron {{ doc.redactions ?? 0 }} datos personales. No entra en tu
            timeline hasta que confirmas.
          </p>
        </div>
      </div>
      <div v-else-if="editing" class="banner">
        <Info class="icon" />
        <p class="secondary">Al confirmar los cambios se actualiza tu timeline.</p>
      </div>

      <!-- Ya confirmado: en limpio -->
      <ClinicalSummary v-if="draft && doc.status === 'confirmed' && !editing" :draft="draft" />

      <!-- Revisión / edición -->
      <template v-else-if="draft && editable">
        <ClinicalFields :draft="draft" :issues="issues" @set="set" @set-report="setReport" />
        <ClinicalValues
          v-if="draft.items.length"
          :items="draft.items"
          :metric-options="metricOptions"
          :is-test="isTest"
          @set-item="setItem"
          @set-metric="setMetric"
        />
        <HolterHours v-if="draft.hourly.length" :hourly="draft.hourly" />

        <footer class="bar">
          <span class="muted">{{ dirty ? 'Cambios sin guardar' : '' }}</span>
          <button v-if="editing" class="btn" :disabled="Boolean(busy)" @click="cancelEdit">
            Cancelar
          </button>
          <button v-else class="btn" :disabled="!dirty || Boolean(busy)" @click="save">
            Guardar
          </button>
          <button class="btn btn-primary" :disabled="Boolean(busy)" @click="confirm">
            {{ doc.status === 'confirmed' ? 'Confirmar cambios' : 'Confirmar' }}
          </button>
        </footer>
      </template>
    </template>
  </div>
</template>

<style scoped>
.panel {
  display: grid;
  gap: 14px;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.spacer {
  flex: 1;
}

.center {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--surface-2);
}

.banner > div,
.banner > p {
  flex: 1;
}

.banner p {
  margin-top: 2px;
  font-size: 13px;
}

.banner a {
  color: var(--text);
  font-weight: 500;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.banner.warning > .icon,
.banner.info > .icon {
  color: var(--warning-text);
}

.banner.critical > .icon {
  color: var(--critical);
}

.spin {
  animation: spin 1.2s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.bar {
  position: sticky;
  bottom: -28px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin: 0 -20px -28px;
  padding: 12px 20px;
  border-top: 1px solid var(--border);
  background: var(--surface);
}

.bar .muted {
  margin-right: auto;
  font-size: 13px;
}
</style>
