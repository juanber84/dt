<script setup>
import { computed } from 'vue';
import Meter from '../ui/Meter.vue';
import { fmtDec, fmtInt } from '../../lib/format.js';
import { liters } from '../../services/today.js';

/**
 * Lo comido frente al objetivo del motor (gasto real con tu comida y tu báscula, no las kcal del
 * reloj) y los líquidos del día.
 */
const props = defineProps({
  day: { type: Object, required: true },
  /** Estado del motor (null si aún no hay datos para calcularlo). */
  engine: { type: Object, default: null },
});

const targets = computed(() => props.engine?.targets ?? null);
const CONFIDENCE_TEXT = {
  none: 'por fórmula, aún sin tus datos',
  low: 'confianza baja',
  medium: 'confianza media',
  high: 'confianza alta',
};
</script>

<template>
  <section class="card card-pad">
    <header class="col-head">
      <h2>Nutrición</h2>
      <span
        v-if="targets"
        class="muted"
        :title="`Gasto real ${fmtInt(engine.expenditure.kcal)} kcal (${CONFIDENCE_TEXT[engine.expenditure.confidence]})`"
        >objetivo {{ fmtInt(targets.kcal) }} kcal</span
      >
    </header>
    <p v-if="day.nutrition.kcal == null" class="secondary nutrition-empty">
      Sin comidas apuntadas este día.
    </p>
    <template v-else>
      <div class="headline">
        <strong class="big">{{ fmtInt(day.nutrition.kcal) }}</strong>
        <span v-if="targets" class="muted"
          >kcal · quedan {{ fmtInt(Math.max(0, targets.kcal - day.nutrition.kcal)) }}</span
        >
        <span v-else class="muted">kcal</span>
      </div>
      <Meter
        v-if="targets"
        :value="day.nutrition.kcal"
        :max="targets.kcal"
        color="var(--nutrition)"
      />
      <dl class="stats">
        <div>
          <dt>Proteína</dt>
          <dd>
            {{ fmtInt(day.nutrition.protein) }}
            <small>/ {{ targets?.proteinG ?? day.nutrition.proteinTarget }} g</small>
          </dd>
        </div>
        <div>
          <dt>Hidratos</dt>
          <dd>
            {{ fmtInt(day.nutrition.carbs) }} <small>/ {{ targets?.carbsG ?? '—' }} g</small>
          </dd>
        </div>
        <div>
          <dt>Grasa</dt>
          <dd>
            {{ fmtInt(day.nutrition.fat) }} <small>/ {{ targets?.fatG ?? '—' }} g</small>
          </dd>
        </div>
      </dl>
    </template>
    <div class="water">
      <span class="section-label">Líquidos</span>
      <span class="num"
        >{{ liters(day.nutrition.fluidMl) }} /
        {{ fmtDec(day.nutrition.fluidTargetMl / 1000, 1) }} L</span
      >
    </div>
    <Meter
      :value="day.nutrition.fluidMl ?? 0"
      :max="day.nutrition.fluidTargetMl"
      color="var(--text-2)"
      :height="4"
    />
    <p v-if="day.nutrition.fluidMl != null" class="water-split muted">
      {{ liters(day.nutrition.waterMl) }} L de agua · {{ liters(day.nutrition.beveragesMl) }} L de
      otras bebidas
    </p>
  </section>
</template>

<style scoped src="./card.css"></style>
<style scoped>
.nutrition-empty {
  margin-bottom: 14px;
}

.water {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 6px;
}

.water-split {
  margin-top: 6px;
  font-size: 11px;
}
</style>
