<script setup>
import { nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { CircleAlert, PanelLeft, Sparkles, Trash2 } from '@lucide/vue';
import CoachComposer from '../components/coach/CoachComposer.vue';
import CoachConversations from '../components/coach/CoachConversations.vue';
import CoachMessage from '../components/coach/CoachMessage.vue';
import { useCoachChat } from '../composables/useCoachChat.js';

const SUGGESTIONS = [
  '¿Cómo he dormido esta semana?',
  '¿Cómo va mi peso este mes?',
  '¿Cuánta proteína como de media?',
  'Resúmeme el día de ayer',
];

const route = useRoute();
const thread = ref(null);
const composer = ref(null);
const listOpen = ref(false);

const {
  conversations,
  unavailable,
  current,
  chat,
  loadingChat,
  streaming,
  contextDate,
  isEmpty,
  send,
  stop,
  remove,
  clearContext,
} = useCoachChat({ scroll: scrollToEnd, focus: () => nextTick(() => composer.value?.focus()) });

/** Una de las preguntas de ejemplo: se envía tal cual y lo que hubiera escrito se va. */
function suggest(text) {
  composer.value?.clear();
  send(text);
}

// Al abrir una conversación se cierra la lista (en el móvil la tapa)
watch(
  () => route.params.id,
  () => {
    listOpen.value = false;
  },
);

/** Baja al final si ya se estaba al final (o si se fuerza): no arrastra a quien está leyendo arriba. */
function scrollToEnd(force = false) {
  const el = thread.value;
  const atEnd = el && el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  nextTick(() => {
    if (thread.value && (force || atEnd)) thread.value.scrollTop = thread.value.scrollHeight;
  });
}
</script>

<template>
  <div class="coach">
    <CoachConversations
      :conversations="conversations"
      :current-id="current?.id"
      :unavailable="unavailable"
      :open="listOpen"
      @close="listOpen = false"
    />

    <section class="card panel">
      <header class="panel-head">
        <button
          class="btn btn-ghost btn-icon btn-sm open-list"
          aria-label="Conversaciones"
          @click="listOpen = true"
        >
          <PanelLeft class="icon" />
        </button>
        <h1>{{ current?.title ?? 'Coach' }}</h1>
        <button
          v-if="current"
          class="btn btn-ghost btn-icon btn-sm"
          title="Borrar conversación"
          aria-label="Borrar conversación"
          :disabled="streaming"
          @click="remove"
        >
          <Trash2 class="icon icon-sm" />
        </button>
      </header>

      <div v-if="unavailable" class="unavailable">
        <CircleAlert class="icon" />
        <p>
          El coach no está disponible: la API necesita un LLM (<code>LLM_API_KEY</code> o
          <code>COACH_LLM_API_KEY</code>) y la base de datos.
        </p>
      </div>

      <div v-else ref="thread" class="thread" aria-live="polite">
        <div v-if="isEmpty" class="welcome">
          <span class="badge"><Sparkles class="icon" /></span>
          <h2>¿En qué te ayudo?</h2>
          <p class="secondary">
            Pregúntame por tu peso, tus comidas, tus entrenos o tu sueño: miro tus datos antes de
            contestar.
          </p>
          <div class="suggestions">
            <button v-for="s in SUGGESTIONS" :key="s" class="btn btn-sm" @click="suggest(s)">
              {{ s }}
            </button>
          </div>
        </div>

        <p v-if="loadingChat" class="muted loading">Cargando…</p>

        <CoachMessage v-for="(m, i) in chat" :key="m.id ?? i" :message="m" />
      </div>

      <CoachComposer
        v-if="!unavailable"
        ref="composer"
        :streaming="streaming"
        :context-date="contextDate"
        @send="send"
        @stop="stop"
        @clear-context="clearContext"
      />
    </section>
  </div>
</template>

<style scoped>
.coach {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 16px;
  height: calc(100dvh - 92px);
  max-width: 1180px;
  margin: 0 auto;
}

.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.panel-head h1 {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thread {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px clamp(16px, 4vw, 48px);
}

.welcome {
  margin: auto;
  display: grid;
  justify-items: center;
  gap: 8px;
  max-width: 460px;
  text-align: center;
}

.badge {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--surface-2);
  border: 1px solid var(--border);
}

.welcome h2 {
  font-size: 18px;
}

.suggestions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin-top: 8px;
}

.loading {
  text-align: center;
}

.unavailable {
  margin: auto;
  display: grid;
  justify-items: center;
  gap: 8px;
  max-width: 420px;
  padding: 24px;
  text-align: center;
  color: var(--text-2);
}

.open-list {
  display: none;
}

@media (max-width: 860px) {
  .coach {
    grid-template-columns: 1fr;
    height: calc(100dvh - var(--content-top) - var(--content-bottom));
  }

  .open-list {
    display: inline-flex;
  }

  .thread {
    padding: 16px;
  }
}
</style>
