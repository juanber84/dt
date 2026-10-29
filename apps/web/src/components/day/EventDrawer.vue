<script setup>
import { computed, ref, watch } from 'vue';
import { ArrowRight, Info, Trash2 } from '@lucide/vue';
import Drawer from '../ui/Drawer.vue';
import ClinicalPanel from '../clinical/ClinicalPanel.vue';
import { TYPE_ICON, TYPE_LABEL, fmtDocDate } from '../../services/clinical.js';
import SourceBadge from '../ui/SourceBadge.vue';
import Hypnogram from '../charts/Hypnogram.vue';
import { iconFor } from '../../lib/icons.js';
import { fmtClock, fmtDec, fmtDuration, fmtInt } from '../../lib/format.js';
import { CATEGORY_COLOR, STAGE_COLOR, STAGE_LABEL } from '../charts/colors.js';
import { sourceName } from '../../data/sources.js';
import { useConfirm } from '../../composables/useConfirm.js';
import { deleteEntry, deleteMealDish } from '../../services/twin.js';

const props = defineProps({
  event: { type: Object, default: null },
  open: { type: Boolean, default: false },
});
// changed/deleted: un informe de Clínica se ha guardado, confirmado o borrado desde aquí
const emit = defineEmits(['close', 'changed', 'deleted']);

// Los informes de Clínica se revisan aquí mismo (más ancho para la tabla de valores)
const clinical = computed(() => props.event?.clinical ?? null);
const dirty = ref(false);
// El documento tal como está ahora (el evento puede ser de antes de leerlo)
const doc = ref(null);
watch(
  () => props.event?.id,
  () => {
    dirty.value = false;
    doc.value = null;
  },
);
const title = computed(() =>
  clinical.value && doc.value
    ? (doc.value.extraction?.title ??
      (doc.value.status === 'processing' ? 'Informe' : doc.value.fileName))
    : (props.event?.title ?? ''),
);
const icon = computed(() =>
  clinical.value && doc.value?.type ? TYPE_ICON[doc.value.type] : props.event?.icon,
);
const { ask } = useConfirm();
let asking = false;
async function close() {
  if (dirty.value) {
    // El Escape que cancela la pregunta también le llega al lateral: no se pregunta dos veces
    if (asking) return;
    asking = true;
    const ok = await ask({
      title: 'Cambios sin guardar',
      message: 'Si cierras ahora, se pierden los cambios de la revisión.',
      confirmLabel: 'Cerrar sin guardar',
      danger: true,
    }).finally(() => setTimeout(() => (asking = false)));
    if (!ok) return;
  }
  dirty.value = false;
  emit('close');
}
function deleted() {
  dirty.value = false;
  emit('deleted');
}

// Lo apuntado a mano (Registrar o el bot, comidas incluidas) se puede borrar desde aquí
const removable = computed(() => Boolean(props.event?.entryId || props.event?.dishId));
const removing = ref(false);
async function removeEntry() {
  const ok = await ask({
    title: `¿Borrar ${props.event.title.toLowerCase()}?`,
    message: 'Se quita de tu día y de tus totales.',
    confirmLabel: 'Borrar',
    danger: true,
  });
  if (!ok) return;
  removing.value = true;
  try {
    await (props.event.dishId
      ? deleteMealDish(props.event.dishId)
      : deleteEntry(props.event.entryId));
    emit('deleted');
  } finally {
    removing.value = false;
  }
}

const color = computed(() => CATEGORY_COLOR[props.event?.category] ?? 'var(--text-2)');
const when = computed(() => {
  const e = props.event;
  if (!e) return '';
  // Un informe: qué es y de qué día (una analítica no tiene hora)
  if (e.clinical && doc.value?.extraction) {
    return `${TYPE_LABEL[doc.value.extraction.type]} · ${fmtDocDate(doc.value.extraction.date)}`;
  }
  if (e.clinical) return e.subtitle;
  return e.end != null
    ? `${fmtClock(e.start)} – ${fmtClock(e.end)} · ${fmtDuration(e.end - e.start)}`
    : fmtClock(e.start);
});

// Zonas de FC: rampa ordinal del naranja de actividad (Z1 clara → Z5 intensa)
const ZONE_MIX = [22, 40, 58, 78, 100];
const zones = computed(() => {
  const z = props.event?.workout?.zones;
  if (!z) return null;
  const total = z.reduce((a, b) => a + b, 0) || 1;
  return z.map((minutes, i) => ({
    label: `Z${i + 1}`,
    minutes,
    pct: (minutes / total) * 100,
    color: `color-mix(in srgb, var(--activity) ${ZONE_MIX[i]}%, var(--surface-2))`,
  }));
});

const metricText = (m) => (m.digits ? fmtDec(m.value, m.digits) : fmtInt(m.value));
const fmtValue = (v) =>
  v == null
    ? '—'
    : Array.isArray(v)
      ? v.join(', ') || '—'
      : typeof v === 'number'
        ? Number.isInteger(v)
          ? fmtInt(v)
          : fmtDec(v, 2)
        : String(v);
const fmtStamp = (iso) =>
  new Date(iso).toLocaleString('es-ES', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
</script>

<template>
  <Drawer :open="open" :title="event?.title ?? ''" :width="clinical ? 760 : 460" @close="close">
    <template #header>
      <div v-if="event" class="head">
        <span class="node" :style="{ '--c': color }">
          <component :is="iconFor(icon)" class="icon" />
        </span>
        <div>
          <h2>{{ title }}</h2>
          <p class="muted">{{ when }}</p>
        </div>
      </div>
    </template>

    <ClinicalPanel
      v-if="clinical"
      :document-id="clinical.documentId"
      @loaded="doc = $event"
      @dirty="dirty = $event"
      @changed="(next, options) => emit('changed', next, options)"
      @deleted="deleted"
    />

    <template v-else-if="event">
      <p class="subtitle secondary">{{ event.subtitle }}</p>
      <RouterLink v-if="event.link" :to="event.link.to" class="btn btn-sm link">
        {{ event.link.label }} <ArrowRight class="icon icon-sm" />
      </RouterLink>

      <dl class="metrics">
        <div v-for="m in event.metrics" :key="m.label">
          <dt>{{ m.label }}</dt>
          <dd>
            {{ metricText(m) }}<small v-if="m.unit"> {{ m.unit }}</small>
          </dd>
        </div>
      </dl>

      <section v-if="event.sleep" class="block">
        <h3>Fases</h3>
        <Hypnogram :stages="event.sleep.stages" />
        <div class="legend">
          <span v-for="k in ['deep', 'light', 'rem', 'awake']" :key="k">
            <span class="dot" :style="{ background: STAGE_COLOR[k] }" />
            {{ STAGE_LABEL[k] }} {{ fmtDuration(event.sleep.totals[k]) }}
          </span>
        </div>
      </section>

      <section v-if="zones" class="block">
        <h3>Zonas de frecuencia cardiaca</h3>
        <div class="zones">
          <div v-for="z in zones" :key="z.label" class="zone">
            <span class="z-label">{{ z.label }}</span>
            <span class="z-track"
              ><span class="z-fill" :style="{ width: `${z.pct}%`, background: z.color }"
            /></span>
            <span class="z-value num">{{ fmtDuration(z.minutes) }}</span>
          </div>
        </div>
      </section>

      <section v-if="event.workout?.exercises" class="block">
        <h3>Ejercicios</h3>
        <table class="sets">
          <thead>
            <tr>
              <th>Ejercicio</th>
              <th>Series</th>
              <th>Reps</th>
              <th>Carga</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(x, i) in event.workout.exercises" :key="i">
              <td>
                {{ x.name }}
                <small v-if="x.muscles?.length" class="muted muscles">{{
                  x.muscles.join(', ')
                }}</small>
              </td>
              <td>{{ x.sets }}</td>
              <td>{{ x.reps }}</td>
              <td>{{ x.load }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="block">
        <h3>Fuentes</h3>
        <p class="hint muted">
          <Info class="icon icon-sm" />
          <span
            >Se guardan todos los registros tal cual llegan. El principal se elige según la
            <RouterLink to="/admin/sources">prioridad de fuentes</RouterLink>.</span
          >
        </p>
        <ul class="records">
          <li v-for="r in event.sources" :key="r.externalId" class="record">
            <div class="record-head">
              <SourceBadge :source="r.source" :size="24" />
              <div>
                <strong>{{ sourceName(r.source) }}</strong>
                <p class="muted">
                  {{ fmtStamp(r.recordedAt) }} · <code>{{ r.externalId }}</code>
                </p>
              </div>
              <span v-if="r.primary" class="primary">Principal</span>
            </div>
            <p v-if="r.note" class="note secondary">{{ r.note }}</p>
            <dl class="raw">
              <template v-for="(v, k) in r.values" :key="k">
                <dt>{{ k }}</dt>
                <dd>{{ fmtValue(v) }}</dd>
              </template>
            </dl>
          </li>
        </ul>
      </section>

      <button
        v-if="removable"
        class="btn btn-danger remove"
        :disabled="removing"
        @click="removeEntry"
      >
        <Trash2 class="icon icon-sm" />
        {{ removing ? 'Borrando…' : 'Borrar este registro' }}
      </button>
    </template>
  </Drawer>
</template>

<style scoped>
.link {
  justify-self: start;
  margin-top: 10px;
}

.head {
  display: flex;
  gap: 12px;
  align-items: center;
}

.head p {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.node {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1.5px solid var(--c);
  color: var(--c);
}

.subtitle {
  margin-bottom: 18px;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1px;
  margin: 0 0 24px;
  border-radius: 12px;
  overflow: hidden;
  background: var(--border);
  border: 1px solid var(--border);
}

.metrics div {
  padding: 12px 14px;
  background: var(--surface);
}

.metrics dt {
  font-size: 12px;
  color: var(--muted);
}

.metrics dd {
  margin: 2px 0 0;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.metrics small {
  margin-left: 3px;
  font-size: 12px;
  font-weight: 400;
  color: var(--muted);
}

.block {
  margin-bottom: 26px;
}

.block h3 {
  margin-bottom: 12px;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-2);
}

.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.zones {
  display: grid;
  gap: 8px;
}

.zone {
  display: grid;
  grid-template-columns: 26px 1fr 56px;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}

.z-label {
  color: var(--muted);
}

.z-track {
  height: 10px;
  border-radius: 4px;
  background: var(--surface-2);
  overflow: hidden;
}

.z-fill {
  display: block;
  height: 100%;
  border-radius: 0 4px 4px 0;
}

.z-value {
  text-align: right;
  color: var(--text-2);
}

.sets {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.sets th {
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  text-align: right;
  padding: 0 0 6px;
}

.sets td {
  padding: 8px 0;
  text-align: right;
  border-top: 1px solid var(--grid);
}

.sets th:first-child,
.sets td:first-child {
  text-align: left;
}

/* Las reps de cada serie ("10 · 8 · 8") pueden ser largas: aire entre columnas */
.sets th + th,
.sets td + td {
  padding-left: 12px;
}

.sets .muscles {
  display: block;
  font-size: 11px;
}

.hint {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  font-size: 12px;
  margin: -4px 0 12px;
}

.hint .icon {
  margin-top: 2px;
}

.hint a {
  color: var(--text);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.records {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.record {
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--surface-2);
}

.record-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.record-head p {
  font-size: 12px;
}

.record-head div {
  flex: 1;
  min-width: 0;
}

code {
  font-family: var(--mono);
  font-size: 11px;
}

.primary {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--text);
  color: var(--inverse);
}

.note {
  font-size: 12px;
  margin-top: 8px;
}

.raw {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 14px;
  margin: 10px 0 0;
  font-family: var(--mono);
  font-size: 11px;
}

.raw dt {
  color: var(--muted);
}

.raw dd {
  margin: 0;
  color: var(--text-2);
  word-break: break-word;
}
.remove {
  display: flex;
  justify-content: center;
  gap: 8px;
  width: 100%;
  margin-top: 24px;
}
</style>
