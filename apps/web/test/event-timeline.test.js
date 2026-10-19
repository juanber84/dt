import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import EventTimeline from '../src/components/day/EventTimeline.vue';

const event = (id, category, start) => ({
  id,
  category,
  icon: 'Moon',
  title: id,
  subtitle: '',
  start,
  metrics: [],
  sources: [{ source: 'manual', primary: true, externalId: id, recordedAt: '', values: {} }],
});

const events = [
  event('sueño', 'sleep', -60),
  event('comida', 'nutrition', 840),
  event('cena', 'nutrition', 1275),
];

describe('EventTimeline', () => {
  it('solo ofrece filtros de categorías que hay en el día', () => {
    const wrapper = mount(EventTimeline, { props: { events } });
    const filters = wrapper.findAll('[role="tab"]').map((t) => t.text());
    expect(filters).toEqual(['Todo', 'Sueño 1', 'Nutrición 2']);
  });

  it('filtra por categoría', async () => {
    const wrapper = mount(EventTimeline, { props: { events } });
    await wrapper.findAll('[role="tab"]')[2].trigger('click');
    expect(wrapper.findAll('li .title').map((t) => t.text())).toEqual(['comida', 'cena']);
  });

  it('emite select al pulsar un evento', async () => {
    const wrapper = mount(EventTimeline, { props: { events } });
    await wrapper.find('li .item').trigger('click');
    expect(wrapper.emitted('select')[0][0].id).toBe('sueño');
  });
});
