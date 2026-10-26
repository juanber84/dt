import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import CoachComposer from '../src/components/coach/CoachComposer.vue';
import CoachMessage from '../src/components/coach/CoachMessage.vue';

vi.mock('../src/services/coach.js', async (importOriginal) => ({
  ...(await importOriginal()),
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  deleteConversation: vi.fn(),
  sendMessage: vi.fn(),
}));
const coach = await import('../src/services/coach.js');
const { useCoachChat } = await import('../src/composables/useCoachChat.js');

describe('CoachComposer', () => {
  it('Intro envía lo escrito y vacía el cuadro; Mayús+Intro no', async () => {
    const wrapper = mount(CoachComposer);
    const box = wrapper.find('textarea');
    await box.setValue('  ¿Cómo duermo?  ');
    await box.trigger('keydown', { key: 'Enter', shiftKey: true });
    expect(wrapper.emitted('send')).toBeUndefined();
    await box.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('send')).toEqual([['¿Cómo duermo?']]);
    expect(box.element.value).toBe('');
  });

  it('mientras responde no envía y el botón es el de parar', async () => {
    const wrapper = mount(CoachComposer, { props: { streaming: true } });
    await wrapper.find('textarea').setValue('Otra');
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('send')).toBeUndefined();
    await wrapper.find('button[aria-label="Parar"]').trigger('click');
    expect(wrapper.emitted('stop')).toHaveLength(1);
  });

  it('el día por el que se pregunta, con su botón para quitarlo', async () => {
    const wrapper = mount(CoachComposer, { props: { contextDate: '2026-10-16' } });
    expect(wrapper.find('.ctx-chip').text()).toContain('Sobre el');
    await wrapper.find('.ctx-chip button').trigger('click');
    expect(wrapper.emitted('clear-context')).toHaveLength(1);
  });
});

describe('CoachMessage', () => {
  const answer = (extra) => ({
    role: 'assistant',
    content: '',
    tools: [],
    charts: [],
    ...extra,
  });

  it('pensando solo mientras no hay texto ni herramienta en marcha', () => {
    const thinking = (message) => mount(CoachMessage, { props: { message } }).find('.thinking');
    expect(thinking(answer({ live: true })).exists()).toBe(true);
    const running = { id: 'a', name: 'list_metrics', args: {}, ok: null };
    expect(thinking(answer({ live: true, tools: [running] })).exists()).toBe(false);
    expect(thinking(answer({ live: true, content: 'Hola' })).exists()).toBe(false);
    expect(thinking(answer({ live: false })).exists()).toBe(false);
  });

  it('los datos consultados, el corte y el error', () => {
    const text = mount(CoachMessage, {
      props: {
        message: answer({
          content: 'Bajas.',
          tools: [{ id: 'a', name: 'list_metrics', args: {}, ok: false }],
          stopped: true,
          error: 'Sin saldo',
        }),
      },
    });
    expect(text.find('.tools li.failed').text()).toBe('Qué datos hay');
    expect(text.text()).toContain('Respuesta cortada.');
    expect(text.find('[role="alert"]').text()).toBe('Sin saldo');
  });

  it('la pregunta, con el día', () => {
    const wrapper = mount(CoachMessage, {
      props: {
        message: { role: 'user', content: '¿Y ayer?', context: { date: '2026-10-16' } },
      },
    });
    expect(wrapper.find('.ctx').text()).toMatch(/^Sobre el 16/);
    expect(wrapper.find('p').text()).toBe('¿Y ayer?');
  });
});

describe('useCoachChat', () => {
  let router;
  let chat;

  async function setup(path = '/coach') {
    const Host = defineComponent({
      setup() {
        chat = useCoachChat();
        return () => h('div');
      },
    });
    router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/coach/:id?', name: 'coach', component: { render: () => null } }],
    });
    router.push(path);
    await router.isReady();
    mount(Host, { global: { plugins: [router] } });
    await flushPromises();
  }

  beforeEach(() => {
    coach.listConversations.mockResolvedValue([{ id: 'old', title: 'Antigua', updatedAt: '' }]);
    coach.getConversation.mockResolvedValue({ id: 'old', title: 'Antigua', messages: [] });
  });
  afterEach(() => vi.clearAllMocks());

  it('una pregunta nueva crea la conversación, la pone arriba y en la URL', async () => {
    await setup();
    coach.sendMessage.mockImplementation(async (body, onEvent) => {
      onEvent('conversation', { id: 'c1', title: 'Sueño', created: true });
      onEvent('delta', { text: 'Duermes bien.' });
      onEvent('message', { id: 'm1', content: 'Duermes bien.' });
    });
    await chat.send('  ¿Cómo duermo?  ');
    await flushPromises();

    expect(coach.sendMessage.mock.calls[0][0]).toEqual({
      conversationId: undefined,
      text: '¿Cómo duermo?',
      context: undefined,
    });
    expect(chat.conversations.value.map((c) => c.id)).toEqual(['c1', 'old']);
    expect(chat.current.value).toEqual({ id: 'c1', title: 'Sueño' });
    expect(router.currentRoute.value.params.id).toBe('c1');
    // La conversación recién creada no se vuelve a cargar al cambiar la URL
    expect(coach.getConversation).not.toHaveBeenCalled();
    const [question, answer] = chat.chat.value;
    expect(question.content).toBe('¿Cómo duermo?');
    expect(answer).toMatchObject({ id: 'm1', content: 'Duermes bien.', live: false });
    expect(chat.streaming.value).toBe(false);
  });

  it('el día de ?date va con la pregunta y luego se quita', async () => {
    await setup('/coach?date=2026-10-16');
    expect(chat.contextDate.value).toBe('2026-10-16');
    coach.sendMessage.mockResolvedValue();
    await chat.send('¿Y ese día?');
    await flushPromises();
    expect(coach.sendMessage.mock.calls[0][0].context).toEqual({ date: '2026-10-16' });
    expect(chat.contextDate.value).toBe(null);
    expect(router.currentRoute.value.query.date).toBeUndefined();
  });

  it('parar corta la respuesta y lo dice', async () => {
    await setup();
    coach.sendMessage.mockImplementation(
      (body, onEvent, { signal }) =>
        new Promise((resolve, reject) =>
          signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          ),
        ),
    );
    const sending = chat.send('Larga');
    await nextTick();
    expect(chat.streaming.value).toBe(true);
    // Mientras responde no sale otra pregunta
    await chat.send('Otra');
    expect(coach.sendMessage).toHaveBeenCalledTimes(1);
    chat.stop();
    await sending;
    expect(chat.chat.value.at(-1)).toMatchObject({ stopped: true, live: false });
    expect(chat.streaming.value).toBe(false);
  });

  it('abrir una conversación de la URL la carga como chat', async () => {
    coach.getConversation.mockResolvedValue({
      id: 'old',
      title: 'Antigua',
      messages: [{ id: '1', role: 'user', content: 'Hola' }],
    });
    await setup('/coach/old');
    expect(coach.getConversation).toHaveBeenCalledWith('old');
    expect(chat.current.value).toEqual({ id: 'old', title: 'Antigua' });
    expect(chat.chat.value).toEqual([
      { id: '1', role: 'user', content: 'Hola', context: undefined },
    ]);
  });

  it('sin coach en la API (404), no disponible', async () => {
    coach.listConversations.mockRejectedValue(Object.assign(new Error('x'), { status: 404 }));
    await setup();
    expect(chat.unavailable.value).toBe(true);
  });
});
