<script setup>
import { ref, watch } from 'vue';
import { KeyRound } from '@lucide/vue';
import Modal from '../ui/Modal.vue';
import PasswordInput from '../ui/PasswordInput.vue';
import { connectMotra } from '../../services/twin.js';

const props = defineProps({ open: { type: Boolean, default: false } });
const emit = defineEmits(['close', 'connected']);

const email = ref('');
const password = ref('');
const error = ref(null);
const busy = ref(false);

watch(
  () => props.open,
  () => {
    email.value = '';
    password.value = '';
    error.value = null;
    busy.value = false;
  },
);

async function submit() {
  busy.value = true;
  error.value = null;
  try {
    const connection = await connectMotra(email.value.trim(), password.value);
    password.value = '';
    emit('connected', connection);
  } catch (err) {
    error.value =
      err.code === 'INVALID_CREDENTIALS'
        ? 'No acepta ese email o contraseña: revísalos.'
        : err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal :open="open" title="Conectar Fuerza (experimental)" @close="emit('close')">
    <form id="motra-form" class="form" @submit.prevent="submit">
      <p class="secondary intro">
        Con el email y la contraseña de tu app de fuerza. Se comprueban haciendo login antes de
        guardarlos y se guardan cifrados.
      </p>
      <label class="field">
        <span>Email</span>
        <input v-model="email" type="email" autocomplete="username" inputmode="email" />
      </label>
      <label class="field">
        <span>Contraseña</span>
        <PasswordInput v-model="password" autocomplete="current-password" />
      </label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </form>

    <p class="note muted">
      <KeyRound class="icon icon-sm" />
      Se traen los entrenos de fuerza (ejercicios, series, repeticiones, peso y descanso) de los
      últimos años.
    </p>

    <template #footer>
      <button class="btn" type="button" @click="emit('close')">Cancelar</button>
      <button
        class="btn btn-primary"
        type="submit"
        form="motra-form"
        :disabled="busy || !email.trim() || !password"
      >
        {{ busy ? 'Comprobando…' : 'Conectar' }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.intro {
  font-size: 13px;
}

.form {
  display: grid;
  gap: 12px;
}

.field input {
  width: 100%;
}

.error {
  font-size: 13px;
  color: var(--critical-text);
}

.note {
  display: flex;
  gap: 6px;
  font-size: 12px;
}

.note .icon {
  margin-top: 2px;
}
</style>
