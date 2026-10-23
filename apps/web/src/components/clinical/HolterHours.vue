<script setup>
import { computed } from 'vue';
import { CircleCheck, TriangleAlert } from '@lucide/vue';

/** El pulso por tramos de un holter, con los que se han comprobado contra el informe. */
const props = defineProps({ hourly: { type: Array, required: true } });
const checked = computed(() => props.hourly.filter((h) => h.verified).length);
</script>

<template>
  <details class="hourly">
    <summary>
      <strong>Pulso por horas</strong>
      <span class="muted">
        {{ hourly.length }} tramos · {{ checked }} comprobados con el informe
      </span>
    </summary>
    <table>
      <thead>
        <tr>
          <th>Tramo</th>
          <th>Mín.</th>
          <th>Media</th>
          <th>Máx.</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="h in hourly" :key="h.start">
          <td class="num">{{ h.start.slice(11) }}–{{ h.end.slice(11) }}</td>
          <td class="num">{{ h.hrMin ?? '—' }}</td>
          <td class="num">{{ h.hrAvg ?? '—' }}</td>
          <td class="num">{{ h.hrMax ?? '—' }}</td>
          <td>
            <CircleCheck v-if="h.verified" class="icon icon-sm ok" />
            <TriangleAlert v-else class="icon icon-sm warn" />
          </td>
        </tr>
      </tbody>
    </table>
    <p class="muted hint">La media de cada tramo va a tu frecuencia cardiaca de esas horas.</p>
  </details>
</template>

<style scoped>
.hourly summary {
  display: flex;
  gap: 10px;
  align-items: baseline;
  cursor: pointer;
}

.hourly summary span {
  font-size: 12px;
}

.hourly table {
  width: 100%;
  margin-top: 10px;
  border-collapse: collapse;
  font-size: 13px;
}

.hourly th {
  text-align: left;
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  padding: 4px 8px 4px 0;
}

.hourly td {
  padding: 4px 8px 4px 0;
  border-top: 1px solid var(--border);
}

.icon.warn {
  color: var(--warning-text);
}

.icon.ok {
  color: var(--good-text);
}

.hint {
  margin-top: 8px;
  font-size: 12px;
}
</style>
