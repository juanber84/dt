<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  ArrowRight,
  CalendarClock,
  CircleCheck,
  Info,
  Pencil,
  RotateCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from '@lucide/vue';
import StatusPill from '../ui/StatusPill.vue';
import LineChart from '../charts/LineChart.vue';
import { useConfirm } from '../../composables/useConfirm.js';
import { useToast } from '../../composables/useToast.js';
import {
  DOCUMENT_ISSUE_LABEL,
  FLAG_LABEL,
  ISSUE_LABEL,
  REPORT_KIND_LABEL,
  SKIP,
  TYPE_GROUPS,
  bySection,
  categoryOf,
  chooseMetric,
  confirmDocument,
  deleteDocument,
  documentIssues,
  editItem,
  fmtDocDate,
  fmtNumber,
  fmtUnit,
  fromDateTimeInput,
  getDocument,
  listMetrics,
  metricChoice,
  metricGroups,
  movedFrom,
  needsLook,
  rangeText,
  retryDocument,
  saveDocument,
  statusPill,
  toDateTimeInput,
} from '../../services/clinical.js';

/**
 * Un documento de Clínica en el lateral del día: se lee, se revisa (corrigiendo lo que haga
 * falta) y se confirma. Ya confirmado se ve en limpio y se puede volver a editar.
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
const onlyIssues = ref(false);
let timer;

const editable = computed(
  () => doc.value?.status === 'review' || (doc.value?.status === 'confirmed' && editing.value),
);
const dirty = computed(
  () =>
    Boolean(draft.value) && JSON.stringify(draft.value) !== JSON.stringify(doc.value?.extraction),
);
const category = computed(() => categoryOf(draft.value?.type));
const isTest = computed(() => category.value === 'test');
const isReport = computed(() => draft.value?.type === 'report');
const groups = computed(() =>
  bySection(
    (draft.value?.items ?? []).filter((item) => !onlyIssues.value || needsLook(item) || item.flag),
  ),
);
const withIssues = computed(() => (draft.value?.items ?? []).filter(needsLook).length);
const flagged = computed(() => (draft.value?.items ?? []).filter((i) => i.flag));
const metricOptions = computed(() => metricGroups(metrics.value));
const hourlyChecked = computed(() => (draft.value?.hourly ?? []).filter((h) => h.verified).length);
const issues = computed(() => documentIssues(draft.value, doc.value?.requestedDate));
const moved = computed(() => doc.value && movedFrom(doc.value));

watch(dirty, (value) => emit('dirty', value));

function show(next) {
  doc.value = next;
  draft.value = next.extraction ? structuredClone(next.extraction) : null;
  emit('loaded', next);
}

async function load() {
  clearTimeout(timer);
  try {
    const next = await getDocument(props.documentId);
    const wasProcessing = doc.value?.status === 'processing';
    // Mientras se edita no se pisa lo escrito
    if (!dirty.value) show(next);
    else doc.value = { ...next, extraction: doc.value.extraction };
    // Al acabar de leerse el día se recarga, sin avisos: el propio lateral dice dónde ha ido
    error.value = null;
    if (next.status === 'processing') timer = setTimeout(load, POLL_MS);
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
const indexOf = (item) => draft.value.items.findIndex((i) => i.id === item.id);
const setReport = (changes) => (draft.value.report = { ...draft.value.report, ...changes });
const recommendationsText = computed({
  get: () => (draft.value?.report?.recommendations ?? []).join('\n'),
  set: (text) =>
    setReport({
      recommendations: text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    }),
});

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

const issueText = (item) =>
  item.issues
    .map((i) => ISSUE_LABEL[i])
    .filter(Boolean)
    .join('\n');
const valueText = (item) => (item.value != null ? fmtNumber(item.value) : item.text || '—');
const hourlyChart = computed(() => {
  const rows = (draft.value?.hourly ?? []).filter((h) => h.hrAvg != null);
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
      ? {
          low: rows.map((h) => h.hrMin),
          high: rows.map((h) => h.hrMax),
          label: 'Mín. – máx.',
        }
      : null,
  };
});
const restText = computed(() => {
  const r = draft.value?.report;
  if (!r?.restFrom && !r?.restTo) return null;
  if (r.restFrom && r.restTo) return `Del ${fmtDocDate(r.restFrom)} al ${fmtDocDate(r.restTo)}`;
  return r.restTo ? `Hasta el ${fmtDocDate(r.restTo)}` : `Desde el ${fmtDocDate(r.restFrom)}`;
});
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
      <template v-if="draft && doc.status === 'confirmed' && !editing">
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

        <RouterLink
          v-if="draft.items.length"
          :to="{ name: 'clinical' }"
          class="btn btn-sm evolution"
        >
          Ver la evolución en Clínica <ArrowRight class="icon icon-sm" />
        </RouterLink>
      </template>

      <!-- Revisión / edición -->
      <template v-else-if="draft && editable">
        <section class="fields">
          <label class="field">
            <span>Tipo</span>
            <select v-model="draft.type" class="input">
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
              @change="draft.date = $event.target.value || null"
            />
          </label>
          <label class="field full">
            <span>Título</span>
            <input v-model="draft.title" class="input" />
          </label>
          <label class="field full">
            <span>Centro</span>
            <input
              class="input"
              :value="draft.center ?? ''"
              @change="draft.center = $event.target.value || null"
            />
          </label>
          <template v-if="isTest">
            <label class="field">
              <span>Inicio</span>
              <input
                class="input num"
                type="datetime-local"
                :value="toDateTimeInput(draft.start)"
                @change="draft.start = fromDateTimeInput($event.target.value)"
              />
            </label>
            <label class="field">
              <span>Fin</span>
              <input
                class="input num"
                type="datetime-local"
                :value="toDateTimeInput(draft.end)"
                @change="draft.end = fromDateTimeInput($event.target.value)"
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
            <textarea v-model="draft.summary" class="input" rows="3" />
          </label>
          <ul v-if="issues.length" class="doc-issues full">
            <li v-for="i in issues" :key="i">
              <TriangleAlert class="icon icon-sm" /> {{ DOCUMENT_ISSUE_LABEL[i] ?? i }}
            </li>
          </ul>
        </section>

        <!-- Los valores -->
        <section v-if="draft.items.length" class="values">
          <header class="values-head">
            <div>
              <h3>{{ isTest ? 'Medidas' : 'Valores' }}</h3>
              <p class="muted">
                {{ draft.items.length }} leídos<template v-if="withIssues">
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
                @change="setItem(indexOf(item), { name: $event.target.value })"
              />
              <span class="result">
                <input
                  class="input num"
                  :value="item.text"
                  aria-label="Resultado"
                  @change="setItem(indexOf(item), { text: $event.target.value })"
                />
                <span v-if="item.flag" class="flag">{{ FLAG_LABEL[item.flag] }}</span>
              </span>
              <input
                class="input"
                :value="item.unit ?? ''"
                aria-label="Unidad"
                @change="setItem(indexOf(item), { unit: $event.target.value || null })"
              />
              <input
                class="input num"
                :value="item.rangeText ?? ''"
                aria-label="Rango"
                placeholder="—"
                @change="setItem(indexOf(item), { rangeText: $event.target.value || null })"
              />
              <select
                class="input"
                :value="metricChoice(item)"
                aria-label="Se guarda como"
                @change="setMetric(indexOf(item), $event.target.value)"
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

        <!-- Tabla por horas del holter -->
        <details v-if="draft.hourly.length" class="hourly">
          <summary>
            <strong>Pulso por horas</strong>
            <span class="muted">
              {{ draft.hourly.length }} tramos · {{ hourlyChecked }} comprobados con el informe
            </span>
          </summary>
          <table>
            <thead>
              <tr>
                <th>Tramo</th>
                <th>Mín.</th>
                <th>Media</th>
                <th>Máx.</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="h in draft.hourly" :key="h.start">
                <td class="num">{{ h.start.slice(11) }}–{{ h.end.slice(11) }}</td>
                <td class="num">{{ h.hrMin ?? '—' }}</td>
                <td class="num">{{ h.hrAvg ?? '—' }}</td>
                <td class="num">{{ h.hrMax ?? '—' }}</td>
                <td>
                  <CircleCheck v-if="h.verified" class="icon icon-sm ok" />
                  <TriangleAlert v-else class="icon icon-sm warn" />
                </td>
              </tr>
            </tbody>
          </table>
          <p class="muted hint">
            La media de cada tramo va a tu frecuencia cardiaca de esas horas.
          </p>
        </details>

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

.fields .input {
  width: 100%;
  min-width: 0;
}

.fields .field {
  min-width: 0;
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

.fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.fields .full {
  grid-column: 1 / -1;
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

.hourly summary {
  display: flex;
  gap: 10px;
  align-items: baseline;
  cursor: pointer;
}

.hourly summary span {
  font-size: 12px;
}

.hourly table {
  width: 100%;
  margin-top: 10px;
  border-collapse: collapse;
  font-size: 13px;
}

.hourly th {
  text-align: left;
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  padding: 4px 8px 4px 0;
}

.hourly td {
  padding: 4px 8px 4px 0;
  border-top: 1px solid var(--border);
}

.hint {
  margin-top: 8px;
  font-size: 12px;
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

  .values-list li {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .values-list .range {
    display: none;
  }
}
</style>
