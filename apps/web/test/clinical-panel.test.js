import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ClinicalFields from '../src/components/clinical/ClinicalFields.vue';
import ClinicalValues from '../src/components/clinical/ClinicalValues.vue';
import ClinicalSummary from '../src/components/clinical/ClinicalSummary.vue';
import HolterHours from '../src/components/clinical/HolterHours.vue';

const item = (id, extra = {}) => ({
  id,
  name: `Valor ${id}`,
  text: '10',
  value: 10,
  unit: 'mg/dL',
  rangeText: '5-15',
  section: 'Bioquímica',
  issues: [],
  flag: null,
  ...extra,
});

describe('Clínica: piezas del lateral', () => {
  it('Campos: no tocan el borrador, avisan de cada cambio', async () => {
    const draft = {
      type: 'report',
      date: '2026-10-07',
      title: 'Informe',
      report: { kind: 'other', recommendations: [] },
      items: [],
    };
    const wrapper = mount(ClinicalFields, { props: { draft } });
    await wrapper.find('input[type="date"]').setValue('2026-10-08');
    await wrapper.find('textarea').setValue('reposo relativo\n\nhielo');
    expect(wrapper.emitted('set')[0]).toEqual([{ date: '2026-10-08' }]);
    expect(wrapper.emitted('set-report').at(-1)).toEqual([
      { recommendations: ['reposo relativo', 'hielo'] },
    ]);
    expect(draft.date).toBe('2026-10-07');
  });

  it('Valores: el filtro de avisos y los cambios con el índice del valor', async () => {
    const items = [item('a'), item('b', { flag: 'high' }), item('c')];
    const wrapper = mount(ClinicalValues, { props: { items } });
    expect(wrapper.text()).toContain('3 leídos');
    await wrapper.find('input[type="checkbox"]').setValue(true);
    expect(wrapper.findAll('.row')).toHaveLength(1);
    await wrapper.find('.row input').setValue('Glucosa');
    expect(wrapper.emitted('set-item')[0]).toEqual([1, { name: 'Glucosa' }]);
  });

  it('En limpio: lo fuera de rango aparte y todos los valores por sección', () => {
    const draft = {
      type: 'lab',
      summary: 'Todo bien',
      items: [item('a'), item('b', { flag: 'high', value: 20 })],
      hourly: [],
    };
    const text = mount(ClinicalSummary, {
      props: { draft },
      global: { stubs: ['RouterLink'] },
    }).text();
    expect(text).toContain('Fuera de rango');
    expect(text).toContain('Bioquímica');
    expect(text).toContain('Todo bien');
  });

  it('Holter: cuántos tramos están comprobados', () => {
    const hourly = [
      {
        start: '2026-09-30T13:30',
        end: '2026-09-30T14:00',
        hrMin: 60,
        hrAvg: 70,
        hrMax: 90,
        verified: true,
      },
      {
        start: '2026-09-30T14:00',
        end: '2026-09-30T15:00',
        hrMin: 55,
        hrAvg: 65,
        hrMax: 85,
        verified: false,
      },
    ];
    expect(mount(HolterHours, { props: { hourly } }).text()).toContain('2 tramos · 1 comprobados');
  });
});
