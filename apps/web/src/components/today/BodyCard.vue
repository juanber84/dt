<script setup>
import Sparkline from '../charts/Sparkline.vue';
import Delta from '../ui/Delta.vue';
import { fmtDec } from '../../lib/format.js';

/** El último pesaje (de los 30 días), cuánto ha cambiado y la serie del peso. */
defineProps({ body: { type: Object, required: true } });
</script>

<template>
  <section class="card card-pad">
    <header class="col-head">
      <h2>Cuerpo</h2>
      <span class="muted">{{
        body.isToday
          ? 'Pesaje de hoy'
          : `Último pesaje: ${body.date.slice(8)}/${body.date.slice(5, 7)}`
      }}</span>
    </header>
    <div class="headline">
      <strong class="big">{{ fmtDec(body.weight, 1) }}</strong>
      <span class="muted">kg</span>
      <Delta :value="body.delta" :digits="1" unit=" kg" good-when="none" versus="en 30 días" />
    </div>
    <Sparkline :values="body.trend" color="var(--text)" :height="36" />
    <dl class="stats">
      <div>
        <dt>Grasa</dt>
        <dd>{{ fmtDec(body.bodyFat, 1) }} <small>%</small></dd>
      </div>
      <div>
        <dt>Músculo</dt>
        <dd>{{ fmtDec(body.muscle, 1) }} <small>kg</small></dd>
      </div>
    </dl>
  </section>
</template>

<style scoped src="./card.css"></style>
