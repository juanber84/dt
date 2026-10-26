<script setup>
import { computed, ref } from 'vue';
import { Check, PillBottle, Plus } from '@lucide/vue';
import { useToast } from '../../composables/useToast.js';
import { createEntry, deleteEntry } from '../../services/twin.js';
import { activeOn, takenAt, takenToday, timingLabel } from '../../services/supplements.js';

/**
 * Los suplementos habituales del día, un chip cada uno: tocarlo apunta la toma y volver a
 * tocarlo la deshace. "Todos" marca los que falten. Lo tomado sale de los eventos del día. Sin
 * ninguno en la lista, cómo añadirlos (si no, nadie sabría que esto existe).
 */
const props = defineProps({
  supplements: { type: Array, required: true },
  date: { type: String, required: true },
  events: { type: Array, required: true },
});
const emit = defineEmits(['changed']);
const toast = useToast();

const active = computed(() => activeOn(props.supplements, props.date));
const taken = computed(() => takenToday(props.events));
const missing = computed(() => active.value.filter((s) => !taken.value.has(s.id)));
// Mientras se guarda, el chip ya cambia (y no se puede volver a tocar)
const busy = ref(new Set());

const isTaken = (s) => taken.value.has(s.id) !== busy.value.has(s.id);

async function run(list, action) {
  busy.value = new Set([...busy.value, ...list.map((s) => s.id)]);
  try {
    await Promise.all(list.map(action));
  } catch (err) {
    toast.show(`No se ha guardado (${err.message})`, 'critical');
  } finally {
    // Primero el día con lo nuevo, después se suelta el chip: así no parpadea
    await new Promise((resolve) => emit('changed', resolve));
    const next = new Set(busy.value);
    for (const s of list) next.delete(s.id);
    busy.value = next;
  }
}

const take = (s) =>
  createEntry({
    kind: 'supplement',
    at: takenAt(s, props.date),
    text: s.name,
    ...(s.dose && { dose: s.dose }),
    supplementId: s.id,
  });

function toggle(s) {
  if (busy.value.has(s.id)) return;
  const entryId = taken.value.get(s.id);
  run([s], entryId ? () => deleteEntry(entryId) : take);
}

const takeAll = () => run(missing.value, take);
</script>

<template>
  <section v-if="!supplements.length" class="card card-pad">
    <header class="col-head">
      <h2>Suplementos</h2>
      <RouterLink :to="{ name: 'settings', query: { add: 'supplement' } }" class="btn btn-sm">
        <Plus class="icon icon-sm" />
        Añadir
      </RouterLink>
    </header>
    <p class="muted empty">
      Creatina, magnesio, vitamina D… Añade los que tomas y márcalos aquí cada día de un toque.
    </p>
  </section>
  <section v-else-if="active.length" class="card card-pad">
    <header class="col-head">
      <h2>Suplementos</h2>
      <button v-if="missing.length > 1" class="btn btn-sm" @click="takeAll">Todos</button>
      <span v-else class="muted">{{ active.length - missing.length }} de {{ active.length }}</span>
    </header>
    <div class="chips" role="group" aria-label="Suplementos del día">
      <button
        v-for="s in active"
        :key="s.id"
        type="button"
        class="chip"
        :class="{ taken: isTaken(s) }"
        :aria-pressed="isTaken(s)"
        :disabled="busy.has(s.id)"
        @click="toggle(s)"
      >
        <Check v-if="isTaken(s)" class="icon icon-sm" />
        <PillBottle v-else class="icon icon-sm" />
        <span class="name">{{ s.name }}</span>
        <span v-if="s.dose || s.timing" class="muted">{{
          [s.dose, timingLabel(s.timing)].filter(Boolean).join(' · ')
        }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped src="./card.css"></style>
<style scoped>
.col-head {
  align-items: center;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
}

.chip:hover {
  border-color: var(--text-2);
  color: var(--text);
}

.chip .muted {
  font-size: 12px;
}

.chip.taken {
  border-color: color-mix(in srgb, var(--nutrition) 55%, var(--border));
  background: color-mix(in srgb, var(--nutrition) 14%, var(--surface));
  color: var(--text);
}

.empty {
  margin: 0;
  font-size: 13px;
}

.chip:disabled {
  cursor: progress;
}
</style>
