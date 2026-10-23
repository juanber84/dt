<script setup>
import Hypnogram from '../charts/Hypnogram.vue';
import { STAGE_COLOR, STAGE_LABEL } from '../charts/colors.js';
import { fmtDuration } from '../../lib/format.js';

/** La noche: las fases (hipnograma) y cuánto de cada una. */
defineProps({ day: { type: Object, required: true } });
</script>

<template>
  <section class="card card-pad">
    <header class="col-head">
      <h2>Sueño</h2>
      <span class="muted">{{ fmtDuration(day.sleep.minutes) }}</span>
    </header>
    <template v-if="day.sleepDetail.stages.length">
      <Hypnogram :stages="day.sleepDetail.stages" :height="120" />
      <div class="legend stage-legend">
        <span v-for="k in ['deep', 'light', 'rem', 'awake']" :key="k">
          <span class="dot" :style="{ background: STAGE_COLOR[k] }" />
          {{ STAGE_LABEL[k] }} {{ fmtDuration(day.sleep[k]) }}
        </span>
      </div>
    </template>
    <p v-else class="muted">Sin noche registrada (¿no dormiste con el reloj?).</p>
  </section>
</template>

<style scoped src="./card.css"></style>
<style scoped>
.stage-legend {
  margin-top: 10px;
}
</style>
