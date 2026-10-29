<script setup>
import { computed, ref } from 'vue';
import { CircleAlert, CircleCheck, Dumbbell, LoaderCircle } from '@lucide/vue';
import { applyTemplate, setLabel } from '../../services/coach.js';

/**
 * Una sesión de fuerza que propone el coach (propose_strength_template), con el botón para
 * guardarla en su app como plantilla. Lo que se guarda es lo que el servidor tiene guardado del
 * mensaje: aquí solo se pide. Guardada, la tarjeta lo dice y el botón desaparece.
 */
const props = defineProps({
  entry: { type: Object, required: true },
});

const saving = ref(false);
const error = ref('');
const template = computed(() => props.entry.template);
const saved = computed(() => template.value.saved);
const totalSets = computed(() =>
  template.value.session.exercises.reduce((n, e) => n + e.sets.length, 0),
);

async function save() {
  if (!props.entry.messageId || saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    props.entry.template = await applyTemplate(props.entry.messageId);
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="template-card" aria-label="Plantilla de fuerza propuesta">
    <header>
      <Dumbbell class="icon icon-sm" />
      <div>
        <h3>{{ template.session.name }}</h3>
        <p class="muted">
          {{ template.session.exercises.length }} ejercicios · {{ totalSets }} series ·
          {{ template.appLabel }}
        </p>
      </div>
    </header>
    <p v-if="template.session.notes" class="notes">{{ template.session.notes }}</p>
    <ol class="exercises">
      <li v-for="(e, i) in template.session.exercises" :key="i">
        <span class="name">{{ e.name }}</span>
        <span class="sets">{{ e.sets.map(setLabel).join(' · ') }}</span>
      </li>
    </ol>
    <footer>
      <p v-if="saved" class="ok">
        <CircleCheck class="icon icon-sm" />
        {{ saved.created ? 'Guardada en tu app' : 'Plantilla reescrita en tu app' }}
      </p>
      <template v-else>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="!entry.messageId || saving"
          @click="save"
        >
          <LoaderCircle v-if="saving" class="icon icon-sm spin" />
          {{ template.templateId ? `Reescribir «${template.replaces}»` : 'Guardar en la app' }}
        </button>
        <p v-if="error" class="error" role="alert">
          <CircleAlert class="icon icon-sm" />
          {{ error }}
        </p>
      </template>
    </footer>
  </section>
</template>

<style scoped>
.template-card {
  margin: 4px 0 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  display: grid;
  gap: 10px;
  min-width: 0;
}

header {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

h3 {
  margin: 0;
  font-size: 15px;
}

header p,
.notes {
  margin: 2px 0 0;
  font-size: 12px;
}

.notes {
  color: var(--text-2);
}

.exercises {
  margin: 0;
  padding-left: 20px;
  display: grid;
  gap: 6px;
  font-size: 13px;
}

.exercises li {
  display: grid;
  gap: 1px;
}

.sets {
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

footer {
  display: grid;
  gap: 6px;
  justify-items: start;
}

footer .btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ok,
.error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 13px;
}

.ok {
  color: var(--good-text);
}

.error {
  color: var(--critical-text);
}

.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
