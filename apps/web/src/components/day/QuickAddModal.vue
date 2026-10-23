<script setup>
import { computed, ref, watch } from 'vue';
import { Droplets, CupSoda, Scale, Stethoscope, NotebookPen, FileHeart, Pill } from '@lucide/vue';
import Modal from '../ui/Modal.vue';
import { uploadDocument, uploadProblem } from '../../services/clinical.js';
import { createEntry, fetchMedications } from '../../services/twin.js';
import { fmtClock } from '../../lib/format.js';
import { formatShortDate, minutesOfDay, todayISO } from '../../lib/dates.js';

const props = defineProps({
  open: { type: Boolean, default: false },
  /** El día que se está viendo: es el que sale por defecto. */
  date: { type: String, required: true },
  /** Con qué tipo se abre ('report' para subir un informe). */
  initialKind: { type: String, default: null },
});
// add: { date, subtitle } de un registro ya guardado; uploaded: { document, created } de un informe
const emit = defineEmits(['close', 'add', 'uploaded']);

const KINDS = [
  {
    id: 'water',
    label: 'Agua',
    icon: Droplets,
    unit: 'ml',
    field: 'Cantidad (ml)',
    default: 500,
    category: 'hydration',
    iconName: 'Droplets',
  },
  {
    id: 'drink',
    label: 'Bebida',
    icon: CupSoda,
    unit: 'ml',
    field: 'Líquido (ml)',
    default: 200,
    category: 'hydration',
    iconName: 'CupSoda',
  },
  {
    id: 'weight',
    label: 'Peso',
    icon: Scale,
    unit: 'kg',
    field: 'Peso (kg)',
    // Sin valor de partida: un peso que no has escrito no se guarda
    default: null,
    category: 'body',
    iconName: 'Scale',
  },
  {
    id: 'symptom',
    label: 'Síntoma',
    icon: Stethoscope,
    unit: 'intensidad (1-5)',
    field: 'Intensidad (1 leve – 5 fuerte)',
    default: 2,
    category: 'note',
    iconName: 'Stethoscope',
  },
  {
    id: 'note',
    label: 'Nota',
    icon: NotebookPen,
    unit: null,
    category: 'note',
    iconName: 'NotebookPen',
  },
  // Una toma: qué medicamento y, si quieres, cuánto
  { id: 'medication', label: 'Medicación', icon: Pill, unit: null },
  // Sube el PDF a Clínica: la fecha la saca del informe (si no trae, la de este día)
  { id: 'report', label: 'Informe', icon: FileHeart, unit: null },
];

// Bebidas típicas: rellenan nombre, ml que hidratan y cafeína aproximada
const DRINKS = [
  { name: 'Café con leche', ml: 200, caffeine: 80 },
  { name: 'Espresso', ml: 30, caffeine: 65 },
  { name: 'Té', ml: 250, caffeine: 40 },
  { name: 'Infusión', ml: 250, caffeine: 0 },
  { name: 'Leche', ml: 250, caffeine: 0 },
  { name: 'Zumo', ml: 200, caffeine: 0 },
  { name: 'Refresco', ml: 330, caffeine: 35 },
];

const kind = ref('water');
const day = ref(props.date);
const time = ref('12:00');
const value = ref(500);
const text = ref('');
const dose = ref('');
const caffeine = ref(0);
const medications = ref([]);
const file = ref(null);
const uploading = ref(false);
const uploadError = ref(null);
const current = computed(() => KINDS.find((k) => k.id === kind.value));
const today = todayISO();

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    if (props.initialKind) kind.value = props.initialKind;
    day.value = props.date;
    time.value = props.date === todayISO() ? fmtClock(minutesOfDay()) : '12:00';
    text.value = '';
    dose.value = '';
    file.value = null;
    // Los que ya has apuntado, para no escribirlos cada vez
    fetchMedications()
      .then((items) => (medications.value = items))
      .catch(() => {});
    uploadError.value = null;
    value.value = current.value.default ?? null;
    caffeine.value = 0;
    if (kind.value === 'drink') pickDrink(DRINKS[0]);
  },
);
/** Rellena la bebida con uno de los tipos (se puede retocar después). */
function pickDrink(drink) {
  text.value = drink.name;
  value.value = drink.ml;
  caffeine.value = drink.caffeine;
}
watch(kind, () => {
  value.value = current.value.default ?? null;
  caffeine.value = 0;
  if (kind.value === 'drink') pickDrink(DRINKS[0]);
  else if (['symptom', 'note', 'medication'].includes(kind.value)) text.value = '';
});

const titles = {
  water: () => `Agua · ${value.value} ml`,
  drink: () =>
    `${text.value || 'Bebida'} · ${value.value} ml${caffeine.value ? ` · ${caffeine.value} mg cafeína` : ''}`,
  weight: () => `Pesaje manual · ${String(value.value).replace('.', ',')} kg`,
  symptom: () => `${text.value || 'Síntoma'} · intensidad ${value.value}/5`,
  note: () => text.value || 'Nota',
  medication: () => `${text.value}${dose.value ? ` · ${dose.value}` : ''}`,
};

async function uploadReport() {
  uploadError.value = uploadProblem(file.value);
  if (uploadError.value) return;
  uploading.value = true;
  try {
    const result = await uploadDocument(file.value, props.date);
    emit('uploaded', result);
    emit('close');
  } catch (err) {
    uploadError.value = `No se ha podido subir: ${err.message}`;
  } finally {
    uploading.value = false;
  }
}

const saving = ref(false);
// Síntomas y notas sin texto no dicen nada; el resto necesita su número
const canSave = computed(() => {
  if (!day.value) return false;
  if (['symptom', 'note', 'medication'].includes(kind.value)) return Boolean(text.value.trim());
  if (kind.value === 'drink' && !text.value.trim()) return false;
  return value.value != null && value.value !== '' && Number(value.value) > 0;
});

async function submit() {
  if (kind.value === 'report') return uploadReport();
  const k = current.value;
  // La hora es la local del día elegido
  const at = new Date(`${day.value}T${time.value}:00`).toISOString();
  saving.value = true;
  uploadError.value = null;
  try {
    await createEntry({
      kind: k.id,
      at,
      ...(k.unit && value.value != null && { value: Number(value.value) }),
      ...(text.value.trim() && { text: text.value.trim() }),
      ...(k.id === 'drink' && caffeine.value > 0 && { caffeineMg: Number(caffeine.value) }),
      ...(k.id === 'medication' && dose.value.trim() && { dose: dose.value.trim() }),
    });
    emit('add', { date: day.value, subtitle: titles[k.id]() });
    emit('close');
  } catch (err) {
    uploadError.value = `No se ha podido guardar: ${err.message}`;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal :open="open" title="Registrar" @close="emit('close')">
    <div class="kinds" role="radiogroup" aria-label="Tipo de registro">
      <button
        v-for="k in KINDS"
        :key="k.id"
        role="radio"
        :aria-checked="kind === k.id"
        :class="{ active: kind === k.id }"
        @click="kind = k.id"
      >
        <component :is="k.icon" class="icon" />
        {{ k.label }}
      </button>
    </div>
    <template v-if="kind === 'report'">
      <label class="field">
        <span>PDF del informe</span>
        <input
          class="input file"
          type="file"
          accept="application/pdf,.pdf"
          @change="file = $event.target.files?.[0] ?? null"
        />
      </label>
      <p class="muted hint">
        Analítica, prueba (holter, esfuerzo, ECG, ecografía…) o informe médico. Va al día de la
        prueba, que se saca del propio informe (si no la trae, al {{ formatShortDate(date) }}). Lo
        revisas en el lateral antes de que entre en tu timeline.
      </p>
      <p v-if="uploadError" class="error" role="alert">{{ uploadError }}</p>
    </template>
    <template v-else>
      <div class="row">
        <label class="field">
          <span>Día</span>
          <input v-model="day" class="input num" type="date" :max="today" required />
        </label>
        <label class="field">
          <span>Hora</span>
          <input v-model="time" class="input num" type="time" required />
        </label>
      </div>
      <template v-if="kind === 'drink'">
        <div class="drinks" role="group" aria-label="Tipo de bebida">
          <button
            v-for="d in DRINKS"
            :key="d.name"
            type="button"
            class="chip"
            :class="{ active: text === d.name }"
            @click="pickDrink(d)"
          >
            {{ d.name }}
          </button>
        </div>
        <label class="field">
          <span>Bebida</span>
          <input v-model="text" class="input" maxlength="60" placeholder="Café con leche, té…" />
        </label>
      </template>
      <label v-if="current.unit" class="field">
        <span>{{ current.field }}</span>
        <input
          v-model="value"
          class="input num"
          type="number"
          :step="kind === 'weight' ? 0.1 : 1"
          :min="kind === 'symptom' ? 1 : 0"
          :max="kind === 'symptom' ? 5 : undefined"
        />
      </label>
      <label v-if="kind === 'drink'" class="field">
        <span>Cafeína (mg)</span>
        <input v-model="caffeine" class="input num" type="number" step="1" min="0" max="1000" />
      </label>
      <p v-if="kind === 'drink'" class="muted hint">
        Cuenta en los líquidos del día. Los ml son lo que bebes (el alcohol no hidrata: no lo
        apuntes aquí).
      </p>
    </template>
    <template v-if="kind === 'medication'">
      <label class="field">
        <span>Medicamento</span>
        <input
          v-model="text"
          class="input"
          list="medications"
          placeholder="Enantyum, Anginovag, ibuprofeno…"
          autocomplete="off"
        />
        <datalist id="medications">
          <option v-for="m in medications" :key="m" :value="m" />
        </datalist>
      </label>
      <label class="field">
        <span>Dosis (opcional)</span>
        <input v-model="dose" class="input" placeholder="1 comprimido, 2 pulverizaciones…" />
      </label>
    </template>
    <label v-if="kind === 'symptom' || kind === 'note'" class="field">
      <span>{{ kind === 'symptom' ? 'Qué notas' : 'Nota' }}</span>
      <textarea
        v-model="text"
        class="input"
        :placeholder="
          kind === 'symptom'
            ? 'Mocos, dolor de garganta, 37,8 de fiebre…'
            : 'Lo que quieras apuntar'
        "
      />
    </label>
    <p v-if="kind !== 'report' && uploadError" class="error" role="alert">{{ uploadError }}</p>
    <p v-if="kind !== 'report'" class="muted hint">
      Se guarda como fuente «Manual». Las comidas mejor por el bot: estima los macros.
    </p>
    <template #footer>
      <button class="btn" @click="emit('close')">Cancelar</button>
      <button
        class="btn btn-primary"
        :disabled="kind === 'report' ? !file || uploading : !canSave || saving"
        @click="submit"
      >
        {{
          kind === 'report'
            ? uploading
              ? 'Subiendo…'
              : 'Subir y leer'
            : saving
              ? 'Guardando…'
              : 'Guardar'
        }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.kinds {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.kinds button {
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 12px 4px 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}

.kinds button:hover {
  border-color: var(--border-strong);
  color: var(--text);
}

.kinds button.active {
  border-color: var(--text);
  color: var(--text);
  background: var(--surface-2);
}

/* Tipos de bebida: rellenan nombre, ml y cafeína */
.drinks {
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

.chip:hover {
  border-color: var(--border-strong);
  color: var(--text);
}

.chip.active {
  border-color: var(--text);
  color: var(--text);
  background: var(--surface-2);
}

.row {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: 12px;
}

.row .input {
  width: 100%;
  min-width: 0;
}

.hint {
  font-size: 12px;
}

.input.file {
  height: auto;
  padding: 8px;
}

.error {
  font-size: 13px;
  color: var(--critical);
}
</style>
