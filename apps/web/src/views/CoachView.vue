<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ArrowUp,
  ChartLine,
  CircleAlert,
  Database,
  LoaderCircle,
  PanelLeft,
  Plus,
  Sparkles,
  Square,
  Trash2,
  X,
} from '@lucide/vue';
import CoachChart from '../components/coach/CoachChart.vue';
import Markdown from '../components/coach/Markdown.vue';
import { useConfirm } from '../composables/useConfirm.js';
import { useToast } from '../composables/useToast.js';
import {
  addChart,
  answerParts,
  deleteConversation,
  getConversation,
  listConversations,
  sendMessage,
  toChat,
  toolLabel,
} from '../services/coach.js';
import { formatShortDate, isValidISODate } from '../lib/dates.js';
import { fmtRelativeTime } from '../lib/format.js';

const SUGGESTIONS = [
  '¿Cómo he dormido esta semana?',
  '¿Cómo va mi peso este mes?',
  '¿Cuánta proteína como de media?',
  'Resúmeme el día de ayer',
];

const route = useRoute();
const router = useRouter();
const toast = useToast();
const { ask } = useConfirm();

const conversations = ref([]);
const unavailable = ref(false);
const listOpen = ref(false);
const current = ref(null); // { id, title }
const chat = ref([]);
const loadingChat = ref(false);
const streaming = ref(false);
const draft = ref('');
const thread = ref(null);
const input = ref(null);
let controller = null;
// La conversación que acaba de crear el stream: al cambiar la URL no hay que volver a cargarla
let justCreated = null;

/** El día desde el que se pregunta (botón "Pregúntale" de Hoy): ?date=YYYY-MM-DD */
const contextDate = ref(null);
watch(
  () => route.query.date,
  (date) => {
    contextDate.value = isValidISODate(date) ? date : null;
  },
  { immediate: true },
);

onMounted(async () => {
  try {
    conversations.value = await listConversations();
  } catch (err) {
    if (err.status === 404) unavailable.value = true;
    else toast.show(`No se han podido cargar las conversaciones (${err.message})`, 'critical');
  }
});

watch(
  () => route.params.id,
  async (id) => {
    listOpen.value = false;
    if (id && id === justCreated) return;
    controller?.abort();
    if (!id) {
      current.value = null;
      chat.value = [];
      focusInput();
      return;
    }
    loadingChat.value = true;
    try {
      const conversation = await getConversation(id);
      current.value = { id: conversation.id, title: conversation.title };
      chat.value = toChat(conversation.messages);
      scrollToEnd(true);
    } catch (err) {
      if (err.status === 404) router.replace({ name: 'coach' });
      else toast.show(`No se ha podido abrir la conversación (${err.message})`, 'critical');
    } finally {
      loadingChat.value = false;
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => controller?.abort());

async function send(text = draft.value) {
  text = text.trim();
  if (!text || streaming.value) return;
  draft.value = '';
  const context = contextDate.value ? { date: contextDate.value } : undefined;
  chat.value.push({ id: `local-${Date.now()}`, role: 'user', content: text, context });
  const answer = reactive({
    id: null,
    role: 'assistant',
    content: '',
    tools: [],
    charts: [],
    live: true,
  });
  chat.value.push(answer);
  scrollToEnd(true);
  clearContext();

  streaming.value = true;
  controller = new AbortController();
  try {
    await sendMessage(
      { conversationId: current.value?.id, text, context },
      (event, data) => onEvent(event, data, answer),
      { signal: controller.signal },
    );
  } catch (err) {
    if (err.name === 'AbortError') answer.stopped = true;
    else answer.error = err.message;
  } finally {
    answer.live = false;
    streaming.value = false;
    controller = null;
    focusInput();
  }
}

function onEvent(event, data, answer) {
  switch (event) {
    case 'conversation':
      current.value = { id: data.id, title: data.title };
      if (data.created) {
        conversations.value.unshift({
          id: data.id,
          title: data.title,
          updatedAt: new Date().toISOString(),
        });
        justCreated = data.id;
        router.replace({ name: 'coach', params: { id: data.id } });
      } else {
        bump(data.id);
      }
      break;
    case 'tool':
      answer.tools.push({ id: data.id, name: data.name, args: data.args, ok: null });
      break;
    case 'tool_result': {
      const tool = answer.tools.find((t) => t.id === data.id);
      if (tool) tool.ok = data.ok;
      if (data.display?.type === 'chart') addChart(answer, data.id, data.display);
      break;
    }
    case 'delta':
      answer.content += data.text;
      break;
    case 'message':
      // Texto antes de llamar a herramientas: lo siguiente va en otro párrafo
      if (data.content && data.toolCalls) answer.content += '\n\n';
      answer.id = data.id;
      break;
    case 'error':
      answer.error = data.message;
      break;
  }
  scrollToEnd();
}

function stop() {
  controller?.abort();
}

function bump(id) {
  const index = conversations.value.findIndex((c) => c.id === id);
  if (index < 0) return;
  const [item] = conversations.value.splice(index, 1);
  conversations.value.unshift({ ...item, updatedAt: new Date().toISOString() });
}

async function remove() {
  const conversation = current.value;
  if (!conversation) return;
  const ok = await ask({
    title: 'Borrar conversación',
    message: `Se borrará «${conversation.title}» con todos sus mensajes.`,
    confirmLabel: 'Borrar',
    danger: true,
  });
  if (!ok) return;
  try {
    await deleteConversation(conversation.id);
    conversations.value = conversations.value.filter((c) => c.id !== conversation.id);
    router.replace({ name: 'coach' });
  } catch (err) {
    toast.show(`No se ha podido borrar (${err.message})`, 'critical');
  }
}

function clearContext() {
  contextDate.value = null;
  if (route.query.date) router.replace({ query: { ...route.query, date: undefined } });
}

function onKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
}

/** Baja al final si ya se estaba al final (o si se fuerza): no arrastra a quien está leyendo arriba. */
function scrollToEnd(force = false) {
  const el = thread.value;
  const atEnd = el && el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  nextTick(() => {
    if (thread.value && (force || atEnd)) thread.value.scrollTop = thread.value.scrollHeight;
  });
}

function focusInput() {
  nextTick(() => input.value?.focus());
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

const isEmpty = computed(() => !chat.value.length && !loadingChat.value);
</script>

<template>
  <div class="coach" :class="{ 'list-open': listOpen }">
    <aside class="conversations" aria-label="Conversaciones">
      <div class="list-head">
        <h2>Conversaciones</h2>
        <button
          class="btn btn-ghost btn-icon btn-sm close-list"
          aria-label="Cerrar"
          @click="listOpen = false"
        >
          <X class="icon icon-sm" />
        </button>
      </div>
      <RouterLink :to="{ name: 'coach' }" class="btn new">
        <Plus class="icon" />
        Nueva conversación
      </RouterLink>
      <nav class="items">
        <RouterLink
          v-for="c in conversations"
          :key="c.id"
          :to="{ name: 'coach', params: { id: c.id } }"
          class="item"
          :class="{ active: current?.id === c.id }"
        >
          <span class="item-title">{{ c.title }}</span>
          <span class="muted item-when">{{ fmtRelativeTime(c.updatedAt) }}</span>
        </RouterLink>
        <p v-if="!conversations.length && !unavailable" class="muted empty-list">
          Aún no has hablado con el coach.
        </p>
      </nav>
    </aside>
    <div class="scrim" @click="listOpen = false" />

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
            <button v-for="s in SUGGESTIONS" :key="s" class="btn btn-sm" @click="send(s)">
              {{ s }}
            </button>
          </div>
        </div>

        <p v-if="loadingChat" class="muted loading">Cargando…</p>

        <template v-for="(m, i) in chat" :key="m.id ?? i">
          <div v-if="m.role === 'user'" class="msg user">
            <span v-if="m.context?.date" class="ctx"
              >Sobre el {{ formatShortDate(m.context.date) }}</span
            >
            <p>{{ m.content }}</p>
          </div>
          <div v-else class="msg assistant">
            <ul v-if="m.tools.length" class="tools" aria-label="Datos consultados">
              <li v-for="t in m.tools" :key="t.id" :class="{ failed: t.ok === false }">
                <LoaderCircle v-if="t.ok === null" class="icon icon-sm spin" />
                <ChartLine v-else-if="t.name === 'show_chart'" class="icon icon-sm" />
                <Database v-else class="icon icon-sm" />
                {{ toolLabel(t.name, t.args) }}
              </li>
            </ul>
            <template v-for="part in answerParts(m)" :key="part.key">
              <CoachChart v-if="part.type === 'chart'" :chart="part.chart" />
              <Markdown v-else :source="part.text" />
            </template>
            <span
              v-if="!m.content && m.live && !m.tools.some((t) => t.ok === null)"
              class="thinking"
            >
              <span /><span /><span />
            </span>
            <p v-if="m.stopped" class="muted note">Respuesta cortada.</p>
            <p v-if="m.error" class="error" role="alert">
              <CircleAlert class="icon icon-sm" />
              {{ m.error }}
            </p>
          </div>
        </template>
      </div>

      <form v-if="!unavailable" class="composer" @submit.prevent="send()">
        <span v-if="contextDate" class="ctx-chip">
          Sobre el {{ formatShortDate(contextDate) }}
          <button type="button" aria-label="Quitar el día" @click="clearContext">
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
            @click="stop"
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

.conversations {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 4px 0;
}

.list-head h2 {
  font-size: 13px;
}

.new {
  justify-content: flex-start;
}

.items {
  display: grid;
  align-content: start;
  gap: 2px;
  overflow-y: auto;
  min-height: 0;
}

.item {
  display: grid;
  gap: 1px;
  padding: 7px 10px;
  border-radius: 8px;
  color: var(--text-2);
}

.item:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.item.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: inset 0 0 0 1px var(--border);
}

.item-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.item-when {
  font-size: 11px;
}

.empty-list {
  padding: 6px 10px;
  font-size: 12px;
}

.close-list,
.open-list,
.scrim {
  display: none;
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

.msg {
  max-width: 720px;
  width: 100%;
}

.msg.user {
  align-self: flex-end;
  width: auto;
  max-width: min(560px, 85%);
  display: grid;
  justify-items: end;
  gap: 4px;
}

.msg.user p {
  margin: 0;
  padding: 9px 14px;
  border-radius: 16px 16px 4px 16px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.ctx {
  font-size: 11px;
  color: var(--muted);
}

.msg.assistant {
  align-self: flex-start;
  display: grid;
  gap: 8px;
}

.tools {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tools li {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 11px;
  color: var(--muted);
}

.tools li.failed {
  color: var(--critical-text);
  border-color: color-mix(in srgb, var(--critical) 30%, transparent);
}

.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.thinking {
  display: inline-flex;
  gap: 4px;
  padding: 6px 0;
}

.thinking span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--muted);
  animation: pulse 1.2s ease-in-out infinite;
}

.thinking span:nth-child(2) {
  animation-delay: 0.15s;
}

.thinking span:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes pulse {
  0%,
  80%,
  100% {
    opacity: 0.25;
  }
  40% {
    opacity: 1;
  }
}

.note {
  margin: 0;
  font-size: 12px;
}

.error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 13px;
  color: var(--critical-text);
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
  .coach {
    grid-template-columns: 1fr;
    height: calc(100dvh - 114px);
  }

  .conversations {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 40;
    width: min(300px, 85vw);
    padding: 16px 12px;
    background: var(--page);
    border-right: 1px solid var(--border);
    transform: translateX(-100%);
    transition: transform 0.2s ease;
  }

  .list-open .conversations {
    transform: none;
  }

  .list-open .scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 35;
    background: var(--overlay);
  }

  .close-list,
  .open-list {
    display: inline-flex;
  }

  .thread {
    padding: 16px;
  }

  .composer {
    padding: 8px 12px 10px;
  }
}
</style>
