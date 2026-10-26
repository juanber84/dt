import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useConfirm } from './useConfirm.js';
import { useToast } from './useToast.js';
import {
  applyEvent,
  deleteConversation,
  getConversation,
  listConversations,
  sendMessage,
  toChat,
} from '../services/coach.js';
import { isValidISODate } from '../lib/dates.js';

/**
 * El chat con el coach: la lista de conversaciones, la abierta (la de la URL, /coach/:id), el
 * envío con su respuesta en streaming, parar y borrar. El día desde el que se pregunta llega en
 * ?date=YYYY-MM-DD (botón "Pregúntale" de Hoy) y va con la siguiente pregunta.
 *
 * Lo que es de la pantalla lo pone la vista: `scroll(force)` baja al final del hilo y `focus()`
 * deja el cursor en el cuadro de texto.
 */
export function useCoachChat({ scroll = () => {}, focus = () => {} } = {}) {
  const route = useRoute();
  const router = useRouter();
  const toast = useToast();
  const { ask } = useConfirm();

  const conversations = ref([]);
  const unavailable = ref(false);
  const current = ref(null); // { id, title }
  const chat = ref([]);
  const loadingChat = ref(false);
  const streaming = ref(false);
  const contextDate = ref(null);
  let controller = null;
  // La conversación que acaba de crear el stream: al cambiar la URL no hay que volver a cargarla
  let justCreated = null;

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
      if (id && id === justCreated) return;
      controller?.abort();
      if (!id) {
        current.value = null;
        chat.value = [];
        focus();
        return;
      }
      loadingChat.value = true;
      try {
        const conversation = await getConversation(id);
        current.value = { id: conversation.id, title: conversation.title };
        chat.value = toChat(conversation.messages);
        scroll(true);
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

  async function send(text) {
    text = text.trim();
    if (!text || streaming.value) return;
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
    scroll(true);
    clearContext();

    streaming.value = true;
    controller = new AbortController();
    try {
      await sendMessage(
        { conversationId: current.value?.id, text, context },
        (event, data) => {
          if (event === 'conversation') opened(data);
          else applyEvent(answer, event, data);
          scroll();
        },
        { signal: controller.signal },
      );
    } catch (err) {
      if (err.name === 'AbortError') answer.stopped = true;
      else answer.error = err.message;
    } finally {
      answer.live = false;
      streaming.value = false;
      controller = null;
      focus();
    }
  }

  /** La conversación de lo que se envía: nueva (arriba de la lista y en la URL) o la de siempre. */
  function opened({ id, title, created }) {
    current.value = { id, title };
    if (created) {
      conversations.value.unshift({ id, title, updatedAt: new Date().toISOString() });
      justCreated = id;
      router.replace({ name: 'coach', params: { id } });
    } else {
      bump(id);
    }
  }

  function bump(id) {
    const index = conversations.value.findIndex((c) => c.id === id);
    if (index < 0) return;
    const [item] = conversations.value.splice(index, 1);
    conversations.value.unshift({ ...item, updatedAt: new Date().toISOString() });
  }

  function stop() {
    controller?.abort();
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

  const isEmpty = computed(() => !chat.value.length && !loadingChat.value);

  return {
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
  };
}
