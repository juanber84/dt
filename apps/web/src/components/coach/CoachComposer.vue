<script setup>
import { nextTick, ref, watch } from 'vue';
import { ArrowUp, Square, X } from '@lucide/vue';
import { formatShortDate } from '../../lib/dates.js';

/**
 * El cuadro para escribir al coach: Intro envía (Mayús+Intro, salto de línea), crece con lo
 * escrito y, mientras responde, el botón para. Encima, el día por el que se pregunta, si hay.
 */
const props = defineProps({
  streaming: { type: Boolean, default: false },
  contextDate: { type: String, default: null },
});
const emit = defineEmits(['send', 'stop', 'clear-context']);

const draft = ref('');
const input = ref(null);

function submit() {
  const text = draft.value.trim();
  if (!text || props.streaming) return;
  draft.value = '';
  emit('send', text);
}

function onKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submit();
  }
}

// El cuadro de texto crece con lo escrito, hasta un tope
watch(draft, () =>
  nextTick(() => {
    const el = input.value;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }),
);

defineExpose({
  focus: () => nextTick(() => input.value?.focus()),
  clear: () => (draft.value = ''),
});
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <span v-if="contextDate" class="ctx-chip">
      Sobre el {{ formatShortDate(contextDate) }}
      <button type="button" aria-label="Quitar el día" @click="$emit('clear-context')">
        <X class="icon icon-sm" />
      </button>
    </span>
    <div class="box">
      <textarea
        ref="input"
        v-model="draft"
        rows="1"
        placeholder="Pregúntale al coach…"
        aria-label="Mensaje para el coach"
        @keydown="onKeydown"
      />
      <button
        v-if="streaming"
        type="button"
        class="btn btn-icon send"
        title="Parar"
        aria-label="Parar"
        @click="$emit('stop')"
      >
        <Square class="icon icon-sm" />
      </button>
      <button
        v-else
        type="submit"
        class="btn btn-primary btn-icon send"
        :disabled="!draft.trim()"
        aria-label="Enviar"
      >
        <ArrowUp class="icon" />
      </button>
    </div>
    <p class="muted hint">El coach puede equivocarse: no sustituye a un médico.</p>
  </form>
</template>

<style scoped>
.composer {
  display: grid;
  gap: 6px;
  padding: 10px clamp(16px, 4vw, 48px) 12px;
  border-top: 1px solid var(--border);
}

.ctx-chip {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 4px 0 10px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-2);
}

.ctx-chip button {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: inherit;
  cursor: pointer;
}

.ctx-chip button:hover {
  background: var(--surface-hover);
}

.box {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 6px 6px 6px 14px;
  border-radius: 18px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
}

.box:focus-within {
  border-color: var(--text-2);
}

.box textarea {
  flex: 1;
  min-height: 24px;
  max-height: 180px;
  padding: 5px 0;
  border: 0;
  outline: none;
  resize: none;
  background: none;
  color: inherit;
  font: inherit;
  line-height: 1.45;
}

.send {
  border-radius: 50%;
}

.hint {
  font-size: 11px;
  text-align: center;
}

@media (max-width: 860px) {
  .composer {
    padding: 8px 12px 10px;
  }
}
</style>
