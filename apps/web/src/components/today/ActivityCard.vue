<script setup>
import BarChart from '../charts/BarChart.vue';
import Meter from '../ui/Meter.vue';
import { fmtCompact, fmtDec, fmtInt } from '../../lib/format.js';

/** Pasos, distancia, kcal activas, pisos y los pasos por hora. */
defineProps({ day: { type: Object, required: true } });

const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const hourLabels = hours.map((h) => `${h}:00 – ${h}:59`);
</script>

<template>
  <section class="card card-pad">
    <header class="col-head">
      <h2>Actividad</h2>
    </header>
    <p v-if="day.steps == null && day.activeKcal == null" class="secondary">
      Sin datos de actividad este día.
    </p>
    <template v-else>
      <div class="headline">
        <strong class="big">{{ fmtInt(day.steps) }}</strong>
        <span class="muted">pasos de 10.000</span>
      </div>
      <Meter :value="day.steps ?? 0" :max="10000" color="var(--activity)" />
      <dl class="stats">
        <div>
          <dt>Distancia</dt>
          <dd>{{ fmtDec(day.distanceKm, 1) }} km</dd>
        </div>
        <div>
          <dt>Kcal activas</dt>
          <dd>{{ fmtInt(day.activeKcal) }}</dd>
        </div>
        <div>
          <dt>Pisos</dt>
          <dd>{{ fmtInt(day.floors) }}</dd>
        </div>
      </dl>
      <BarChart
        :labels="hours"
        :tooltip-labels="hourLabels"
        :series="[
          {
            id: 'steps',
            label: 'Pasos',
            color: 'var(--activity)',
            values: day.stepsByHour,
          },
        ]"
        :height="110"
        :x-tick-every="6"
        :format="fmtInt"
        :tick-format="fmtCompact"
        integer
      />
    </template>
  </section>
</template>

<style scoped src="./card.css"></style>
