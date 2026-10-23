<script setup>
import DayStrip from '../charts/DayStrip.vue';

/** La franja de 24 h: frecuencia cardiaca y los eventos del día. */
defineProps({
  hr: { type: Array, required: true },
  events: { type: Array, required: true },
  until: { type: Number, default: 1440 },
  selectedId: { type: String, default: null },
});
const emit = defineEmits(['select']);
</script>

<template>
  <section class="card card-pad">
    <header class="strip-head">
      <h2>Tu día</h2>
      <div class="legend">
        <span><span class="line-key" />Frecuencia cardiaca</span>
        <span><span class="dot" style="background: var(--sleep)" />Sueño</span>
        <span><span class="dot" style="background: var(--activity)" />Actividad</span>
        <span><span class="dot" style="background: var(--nutrition)" />Nutrición</span>
        <span><span class="dot" style="background: var(--text-2)" />Otros</span>
      </div>
    </header>
    <DayStrip
      :hr="hr"
      :events="events"
      :until="until"
      :selected-id="selectedId"
      @select="(event) => emit('select', event)"
    />
  </section>
</template>

<style scoped src="./card.css"></style>
<style scoped>
.strip-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-bottom: 8px;
}

.line-key {
  width: 14px;
  height: 2px;
  border-radius: 1px;
  background: var(--hr-line);
}
</style>
