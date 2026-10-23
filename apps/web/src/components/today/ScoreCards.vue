<script setup>
import { computed } from 'vue';
import ScoreRing from '../charts/ScoreRing.vue';
import StatusPill from '../ui/StatusPill.vue';
import { fmtDuration, fmtInt, fmtSigned } from '../../lib/format.js';
import { insightOf, recoveryOf } from '../../services/today.js';

/** Los tres anillos (recuperación, sueño y carga) y la frase del día. */
const props = defineProps({
  day: { type: Object, required: true },
  /** Los 30 días anteriores (para comparar la VFC con tu media). */
  history: { type: Array, default: () => [] },
});

const recovery = computed(() => recoveryOf(props.day));
const insight = computed(() => insightOf(props.day, props.history));
</script>

<template>
  <section class="scores">
    <div class="card score">
      <ScoreRing :value="day.recovery" :color="recovery.color" unit="%" label="Recuperación" />
      <div class="score-text">
        <span class="section-label">Recuperación</span>
        <StatusPill :tone="recovery.tone" :label="recovery.label" />
        <p class="secondary">VFC {{ fmtInt(day.hrv) }} ms · reposo {{ fmtInt(day.rhr) }} ppm</p>
      </div>
    </div>
    <div class="card score">
      <ScoreRing :value="day.sleep.score" color="var(--sleep)" label="Sueño" />
      <div class="score-text">
        <span class="section-label">Sueño</span>
        <template v-if="day.sleep.minutes != null">
          <strong class="big">{{ fmtDuration(day.sleep.minutes) }}</strong>
          <p class="secondary">
            de {{ fmtDuration(day.sleep.need) }} · eficiencia {{ day.sleep.efficiency }} %
          </p>
        </template>
        <p v-else class="secondary">Sin noche registrada</p>
      </div>
    </div>
    <div class="card score">
      <ScoreRing :value="day.load?.tss" :max="150" color="var(--activity)" label="Carga" />
      <div class="score-text">
        <span class="section-label">Carga del día · TSS</span>
        <template v-if="day.load">
          <strong class="big">{{ day.load.tss ? `${day.load.tss} TSS` : 'Descanso' }}</strong>
          <p class="secondary">
            Forma {{ fmtSigned(day.load.tsb) }} · fitness {{ fmtInt(day.load.ctl) }}
          </p>
        </template>
        <p v-else class="secondary">Sin datos de intervals.icu este día</p>
      </div>
    </div>
    <p class="insight">{{ insight }}</p>
  </section>
</template>

<style scoped src="./layout.css"></style>
<style scoped src="./card.css"></style>
<style scoped>
.insight {
  grid-column: 1 / -1;
  padding: 2px 4px;
  color: var(--text-2);
  font-size: 14px;
}

@media (max-width: 860px) {
  .score :deep(.ring) {
    width: 76px !important;
    height: 76px !important;
  }

  .score :deep(.ring svg) {
    width: 100%;
    height: 100%;
  }

  .score :deep(.ring .value) {
    font-size: 22px;
  }

  .score-text .section-label {
    font-size: 11px;
  }

  .insight {
    padding: 2px;
    font-size: 13px;
  }
}
</style>
