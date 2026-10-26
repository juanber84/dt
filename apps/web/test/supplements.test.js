import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { entryEvent } from '../src/services/timeline.js';
import { activeOn, takenAt, takenToday, typeOf } from '../src/services/supplements.js';
import { todayISO } from '../src/lib/dates.js';

vi.mock('../src/services/twin.js', () => ({
  createEntry: vi.fn(async () => ({})),
  deleteEntry: vi.fn(async () => {}),
}));
const twin = await import('../src/services/twin.js');
const { default: SupplementsCard } = await import('../src/components/today/SupplementsCard.vue');
const { default: CreatineBanner } = await import('../src/components/today/CreatineBanner.vue');

const creatine = {
  id: 'cr',
  name: 'Creatina',
  dose: '5 g',
  timing: 'morning',
  startedOn: '2026-10-01',
  stoppedOn: null,
};
const magnesium = {
  id: 'mg',
  name: 'Magnesio',
  dose: null,
  timing: 'night',
  startedOn: '2026-10-01',
  stoppedOn: null,
};
const omega = { id: 'om', name: 'Omega-3', timing: null, startedOn: '2026-10-20', stoppedOn: null };
const zinc = {
  id: 'zn',
  name: 'Zinc',
  timing: 'morning',
  startedOn: '2026-09-01',
  stoppedOn: '2026-10-10',
};

describe('suplementos: lo puro', () => {
  it('los de un día: ya empezados, sin dejar (el día que lo deja ya no), por momento del día', () => {
    const all = [magnesium, omega, zinc, creatine];
    expect(activeOn(all, '2026-10-26').map((s) => s.id)).toEqual(['cr', 'mg', 'om']);
    expect(activeOn(all, '2026-10-09').map((s) => s.id)).toEqual(['cr', 'zn', 'mg']);
    expect(activeOn(all, '2026-10-10').map((s) => s.id)).toEqual(['cr', 'mg']);
  });

  it('la hora de la toma: ahora si es hoy; otro día, la de su momento (o mediodía)', () => {
    const now = new Date('2026-10-26T10:15:00Z');
    expect(takenAt(creatine, todayISO(), now)).toBe(now.toISOString());
    expect(new Date(takenAt(creatine, '2026-10-20')).getHours()).toBe(9);
    expect(new Date(takenAt(magnesium, '2026-10-20')).getHours()).toBe(22);
    expect(new Date(takenAt(omega, '2026-10-20')).getHours()).toBe(12);
  });

  it('el tipo sale del nombre (solo importa la creatina)', () => {
    expect(typeOf('Creatina monohidrato')).toBe('creatine');
    expect(typeOf('creatine HCL')).toBe('creatine');
    expect(typeOf('Vitamina D3')).toBe('vitamin_d');
    expect(typeOf('Bisglicinato de magnesio')).toBe('magnesium');
    expect(typeOf('Zinc')).toBe('other');
  });

  it('la toma en el timeline: evento con cuál es, y se puede borrar', () => {
    const event = entryEvent({
      id: 'e1',
      kind: 'supplement',
      externalId: 'x1',
      start: '2026-10-26T07:00:00Z',
      title: 'Creatina',
      summary: { dose: '5 g', supplementId: 'cr' },
      provider: 'digitaltwin',
      origin: { channel: 'manual' },
    });
    expect(event).toMatchObject({
      title: 'Creatina',
      subtitle: 'Suplemento · 5 g',
      icon: 'PillBottle',
      entryId: 'x1',
      supplementId: 'cr',
    });
    expect(takenToday([event, { id: 'otro', entryId: 'y' }])).toEqual(new Map([['cr', 'x1']]));
  });
});

describe('SupplementsCard', () => {
  afterEach(() => vi.clearAllMocks());
  const mountCard = (events = []) =>
    mount(SupplementsCard, {
      props: { supplements: [creatine, magnesium, zinc], date: '2026-10-26', events },
      // El padre recarga el día y avisa (aquí, al momento)
      attrs: { onChanged: (done) => done() },
    });

  it('un chip por cada uno de ese día; tocarlo apunta la toma con su dosis y cuál es', async () => {
    const wrapper = mountCard();
    const chips = wrapper.findAll('.chip');
    expect(chips.map((c) => c.find('.name').text())).toEqual(['Creatina', 'Magnesio']);
    expect(chips[0].text()).toContain('5 g · Mañana');
    await chips[0].trigger('click');
    await flushPromises();
    expect(twin.createEntry).toHaveBeenCalledWith({
      kind: 'supplement',
      at: expect.any(String),
      text: 'Creatina',
      dose: '5 g',
      supplementId: 'cr',
    });
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });

  it('tocar uno ya tomado lo deshace; "Todos" marca solo los que faltan', async () => {
    const taken = { id: 'e1', entryId: 'x1', supplementId: 'cr' };
    const wrapper = mountCard([taken]);
    expect(wrapper.find('.chip.taken .name').text()).toBe('Creatina');
    expect(wrapper.find('.col-head').text()).toContain('1 de 2');
    await wrapper.find('.chip.taken').trigger('click');
    await flushPromises();
    expect(twin.deleteEntry).toHaveBeenCalledWith('x1');

    const none = mountCard();
    await none.find('.col-head button').trigger('click');
    await flushPromises();
    expect(twin.createEntry.mock.calls.map(([e]) => e.supplementId)).toEqual(['cr', 'mg']);
  });

  it('sin ninguno en la lista: cómo añadirlos (enlace a Ajustes con el formulario abierto)', () => {
    const wrapper = mount(SupplementsCard, {
      props: { supplements: [], date: '2026-10-26', events: [] },
      global: {
        stubs: {
          RouterLink: { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' },
        },
      },
    });
    expect(wrapper.text()).toContain('Añade los que tomas');
    expect(JSON.parse(wrapper.find('a').attributes('data-to'))).toEqual({
      name: 'settings',
      query: { add: 'supplement' },
    });
  });

  it('con lista pero ninguno ese día (aún no los tomabas), no sale', () => {
    const wrapper = mount(SupplementsCard, {
      props: { supplements: [zinc], date: '2026-10-26', events: [] },
    });
    expect(wrapper.find('section').exists()).toBe(false);
  });
});

describe('CreatineBanner', () => {
  it('dice que es agua, con la frase del motor', () => {
    const text = mount(CreatineBanner, {
      props: { notice: { phase: 'starting', name: 'Creatina', since: '2026-10-20', daysSince: 6 } },
    }).text();
    expect(text).toContain('Creatina: el peso sube agua');
    expect(text).toContain('Empezaste la creatina el 20/10');
  });
});
