<script setup>
import { onMounted, ref } from 'vue';
import Segmented from '../ui/Segmented.vue';
import { useToast } from '../../composables/useToast.js';
import { fetchEngine, fetchProfile, saveProfile } from '../../services/twin.js';

const toast = useToast();
const profile = ref(null);

onMounted(async () => {
  try {
    profile.value = await fetchProfile();
    const engine = await fetchEngine().catch(() => null);
    lastWeight.value = engine?.weight?.trend ?? null;
  } catch {
    profile.value = null;
  }
});

// Ritmo en % del peso por semana: de 0,25 a 1 % perdiendo (más rápido cuesta músculo y rendimiento)
const RATES = [
  { value: -1, label: '−1 %' },
  { value: -0.75, label: '−0,75 %' },
  { value: -0.5, label: '−0,5 %' },
  { value: -0.25, label: '−0,25 %' },
  { value: 0, label: 'Mantener' },
];
const kgPerWeek = (pct) =>
  profile.value?.heightCm && lastWeight.value
    ? `${((Math.abs(pct) * lastWeight.value) / 100).toFixed(2).replace('.', ',')} kg/semana`
    : null;
const lastWeight = ref(null);

const SEXES = [
  { value: 'male', label: 'Hombre' },
  { value: 'female', label: 'Mujer' },
];

async function save(patch) {
  try {
    profile.value = await saveProfile(patch);
  } catch (err) {
    toast.show(`No se ha guardado (${err.message})`, 'critical');
  }
}

/** Número de un input (vacío = sin valor: vuelve a usar el de la báscula). */
const number = (value) => (value === '' ? null : Number(String(value).replace(',', '.')));
const fromScale = (field) => profile.value?.sources?.[field] === 'scale';
</script>

<template>
  <section v-if="profile">
    <h2 class="sub">Tus datos</h2>
    <p class="secondary sub-desc">
      Lo usa el coach para sus cifras (proteína, gasto, frecuencia máxima…). Lo que no rellenes sale
      de tu báscula.
    </p>
    <div class="card fields">
      <div class="field">
        <span class="label">Sexo <small v-if="fromScale('sex')">· de la báscula</small></span>
        <Segmented
          :model-value="profile.sex ?? ''"
          :options="SEXES"
          label="Sexo"
          @update:model-value="save({ sex: $event })"
        />
      </div>
      <label class="field">
        <span class="label"
          >Fecha de nacimiento <small v-if="fromScale('birthDate')">· de la báscula</small></span
        >
        <span class="with-hint">
          <input
            class="input"
            type="date"
            :value="profile.birthDate ?? ''"
            @change="save({ birthDate: $event.target.value || null })"
          />
          <span v-if="profile.age != null" class="muted">{{ profile.age }} años</span>
        </span>
      </label>
      <label class="field">
        <span class="label"
          >Altura <small v-if="fromScale('heightCm')">· de la báscula</small></span
        >
        <span class="with-hint">
          <input
            class="input num"
            type="number"
            inputmode="decimal"
            min="50"
            max="260"
            :value="profile.heightCm ?? ''"
            @change="save({ heightCm: number($event.target.value) })"
          />
          <span class="muted">cm</span>
        </span>
      </label>
      <label class="field">
        <span class="label"
          >Peso objetivo <small v-if="fromScale('weightGoalKg')">· de la báscula</small></span
        >
        <span class="with-hint">
          <input
            class="input num"
            type="number"
            inputmode="decimal"
            step="0.1"
            :value="profile.weightGoalKg ?? ''"
            placeholder="Opcional"
            @change="save({ weightGoalKg: number($event.target.value) })"
          />
          <span class="muted">kg</span>
        </span>
      </label>
    </div>

    <h2 class="sub">Para el motor</h2>
    <p class="secondary sub-desc">
      Con tu comida y tu báscula calcula lo que gastas de verdad y tus objetivos de cada día.
    </p>
    <div class="card fields">
      <div class="field">
        <span class="label">Ritmo de peso por semana</span>
        <Segmented
          :model-value="profile.weeklyRatePct ?? -0.5"
          :options="RATES"
          label="Ritmo"
          @update:model-value="save({ weeklyRatePct: $event })"
        />
        <small
          v-if="(profile.weeklyRatePct ?? -0.5) !== 0 && kgPerWeek(profile.weeklyRatePct ?? -0.5)"
          class="muted"
          >Perder unos {{ kgPerWeek(profile.weeklyRatePct ?? -0.5) }}. Si entrenas fuerte, mejor
          entre −0,25 % y −0,5 %.</small
        >
      </div>
      <label class="field">
        <span class="label">Apunto todo lo que como desde</span>
        <input
          class="input"
          type="date"
          :value="profile.loggingSince ?? ''"
          @change="save({ loggingSince: $event.target.value || null })"
        />
        <small class="muted"
          >Los días de antes no cuentan para calcular tu gasto (si faltan comidas,
          engañarían).</small
        >
      </label>
    </div>
  </section>
</template>

<style scoped>
.sub {
  margin: 32px 0 4px;
  font-size: 15px;
}

.sub-desc {
  margin-bottom: 12px;
  font-size: 13px;
}

.fields {
  display: grid;
  gap: 16px;
  padding: 16px;
}

.field {
  display: grid;
  gap: 6px;
}

.label {
  font-size: 13px;
  color: var(--text-2);
}

.label small {
  color: var(--muted);
}

.with-hint {
  display: flex;
  align-items: center;
  gap: 10px;
}

.with-hint .input {
  max-width: 200px;
}
</style>
