<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ChevronRight, PillBottle, Plus } from '@lucide/vue';
import Modal from '../ui/Modal.vue';
import { useConfirm } from '../../composables/useConfirm.js';
import { useToast } from '../../composables/useToast.js';
import { formatShortDate, todayISO } from '../../lib/dates.js';
import {
  PRESETS,
  TIMINGS,
  createSupplement,
  deleteSupplement,
  listSupplements,
  timingLabel,
  typeOf,
  updateSupplement,
} from '../../services/supplements.js';

/**
 * Los suplementos habituales: salen en Hoy para marcarlos de un toque. Cada uno con su dosis, su
 * momento del día y desde cuándo; dejarlo guarda la fecha (la creatina avisa al empezar y al
 * dejarla: el peso mueve agua).
 */
const toast = useToast();
const { ask } = useConfirm();

const items = ref(null);
const current = computed(() => (items.value ?? []).filter((s) => !s.stoppedOn));
const stopped = computed(() => (items.value ?? []).filter((s) => s.stoppedOn));

onMounted(async () => {
  try {
    items.value = await listSupplements();
  } catch {
    items.value = null;
  }
});

const open = ref(false);
const saving = ref(false);
const editing = ref(null); // el suplemento que se edita (null: uno nuevo)
const form = reactive({ name: '', dose: '', timing: '', startedOn: '' });

function edit(supplement = null) {
  editing.value = supplement;
  Object.assign(form, {
    name: supplement?.name ?? '',
    dose: supplement?.dose ?? '',
    timing: supplement?.timing ?? '',
    startedOn: supplement?.startedOn ?? todayISO(),
  });
  open.value = true;
}

function preset(p) {
  Object.assign(form, { name: p.name, dose: p.dose, timing: p.timing });
}

async function call(action, done) {
  saving.value = true;
  try {
    await action();
    items.value = await listSupplements();
    open.value = false;
    if (done) toast.show(done);
  } catch (err) {
    toast.show(`No se ha guardado (${err.message})`, 'critical');
  } finally {
    saving.value = false;
  }
}

function save() {
  const input = {
    name: form.name.trim(),
    type: typeOf(form.name),
    dose: form.dose.trim() || null,
    timing: form.timing || null,
    startedOn: form.startedOn,
  };
  if (!input.name || !input.startedOn) return;
  call(() => (editing.value ? updateSupplement(editing.value.id, input) : createSupplement(input)));
}

const stop = () =>
  call(
    () => updateSupplement(editing.value.id, { stoppedOn: todayISO() }),
    `${editing.value.name}: lo has dejado hoy`,
  );

// Volver a tomarlo empieza de nuevo (para la creatina, el agua vuelve a subir)
const resume = () =>
  call(
    () => updateSupplement(editing.value.id, { startedOn: todayISO(), stoppedOn: null }),
    `${editing.value.name}: de nuevo desde hoy`,
  );

async function remove() {
  const s = editing.value;
  const ok = await ask({
    title: 'Borrar suplemento',
    message: `Se quita «${s.name}» de tu lista. Las tomas que ya apuntaste se quedan en sus días.`,
    confirmLabel: 'Borrar',
    danger: true,
  });
  if (ok) call(() => deleteSupplement(s.id));
}

const detail = (s) =>
  [
    s.dose,
    timingLabel(s.timing),
    s.stoppedOn
      ? `lo dejaste el ${formatShortDate(s.stoppedOn)}`
      : `desde el ${formatShortDate(s.startedOn)}`,
  ]
    .filter(Boolean)
    .join(' · ');
</script>

<template>
  <section v-if="items">
    <h2 class="sub">Suplementos</h2>
    <p class="secondary sub-desc">
      Los que tomas a diario: salen en Hoy para marcarlos de un toque. Lo que tiene calorías
      (proteína en polvo, barritas, geles) va como comida.
    </p>
    <div class="card list">
      <button v-for="s in current" :key="s.id" type="button" class="row" @click="edit(s)">
        <PillBottle class="icon" />
        <span class="what">
          <span class="name">{{ s.name }}</span>
          <span class="muted">{{ detail(s) }}</span>
        </span>
        <ChevronRight class="icon icon-sm muted" />
      </button>
      <p v-if="!current.length" class="muted empty">Aún no tienes ninguno.</p>
      <button type="button" class="row add" @click="edit()">
        <Plus class="icon" />
        Añadir suplemento
      </button>
    </div>
    <template v-if="stopped.length">
      <h3 class="past">Los que has dejado</h3>
      <div class="card list">
        <button v-for="s in stopped" :key="s.id" type="button" class="row" @click="edit(s)">
          <PillBottle class="icon muted" />
          <span class="what">
            <span class="name muted">{{ s.name }}</span>
            <span class="muted">{{ detail(s) }}</span>
          </span>
          <ChevronRight class="icon icon-sm muted" />
        </button>
      </div>
    </template>

    <Modal :open="open" :title="editing ? editing.name : 'Añadir suplemento'" @close="open = false">
      <div v-if="!editing" class="presets" role="group" aria-label="Los más habituales">
        <button
          v-for="p in PRESETS"
          :key="p.name"
          type="button"
          class="chip"
          :class="{ active: form.name === p.name }"
          @click="preset(p)"
        >
          {{ p.name }}
        </button>
      </div>
      <label class="field">
        <span>Nombre</span>
        <input v-model="form.name" class="input" maxlength="60" placeholder="Creatina, zinc…" />
      </label>
      <div class="pair">
        <label class="field">
          <span>Dosis (opcional)</span>
          <input v-model="form.dose" class="input" maxlength="40" placeholder="5 g, 1 cápsula…" />
        </label>
        <label class="field">
          <span>Cuándo</span>
          <select v-model="form.timing" class="input">
            <option value="">Cuando sea</option>
            <option v-for="t in TIMINGS" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
        </label>
      </div>
      <label class="field">
        <span>Lo tomas desde</span>
        <input v-model="form.startedOn" class="input" type="date" required />
      </label>
      <p v-if="typeOf(form.name) === 'creatine'" class="muted hint">
        Las primeras 3-4 semanas el peso sube 1-2 kg de agua en el músculo (y baja al dejarla). No
        es grasa: Hoy, el coach y el informe te lo recordarán.
      </p>
      <template #footer>
        <template v-if="editing">
          <button class="btn btn-ghost danger" :disabled="saving" @click="remove">Borrar</button>
          <button v-if="editing.stoppedOn" class="btn" :disabled="saving" @click="resume">
            Volver a tomarlo
          </button>
          <button v-else class="btn" :disabled="saving" @click="stop">Lo dejo</button>
        </template>
        <button
          class="btn btn-primary"
          :disabled="saving || !form.name.trim() || !form.startedOn"
          @click="save"
        >
          {{ saving ? 'Guardando…' : 'Guardar' }}
        </button>
      </template>
    </Modal>
  </section>
</template>

<style scoped>
.sub {
  margin: 32px 0 4px;
  font-size: 15px;
}

.sub-desc {
  margin-bottom: 12px;
  font-size: 13px;
}

.past {
  margin: 16px 0 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-2);
}

.list {
  display: grid;
  overflow: hidden;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 52px;
  padding: 10px 16px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.row:last-child {
  border-bottom: 0;
}

.row:hover {
  background: var(--surface-hover);
}

.what {
  display: grid;
  flex: 1;
  min-width: 0;
}

.what .muted {
  font-size: 12px;
}

.add {
  color: var(--text-2);
}

.empty {
  padding: 14px 16px 4px;
  font-size: 13px;
}

.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}

.chip.active {
  border-color: var(--text);
  color: var(--text);
  background: var(--surface-2);
}

.pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}

.hint {
  font-size: 12px;
}

.danger {
  margin-right: auto;
  color: var(--critical-text);
}
</style>
