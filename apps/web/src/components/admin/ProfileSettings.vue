<script setup>
import { onMounted, ref } from 'vue';
import Segmented from '../ui/Segmented.vue';
import { useToast } from '../../composables/useToast.js';
import { fetchProfile, saveProfile } from '../../services/twin.js';

const toast = useToast();
const profile = ref(null);

onMounted(async () => {
  try {
    profile.value = await fetchProfile();
  } catch {
    profile.value = null;
  }
});

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
