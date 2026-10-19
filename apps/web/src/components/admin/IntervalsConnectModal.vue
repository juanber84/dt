<script setup>
import { ref, watch } from 'vue';
import { KeyRound } from '@lucide/vue';
import Modal from '../ui/Modal.vue';
import PasswordInput from '../ui/PasswordInput.vue';
import { connectIntervals } from '../../services/twin.js';

const props = defineProps({ open: { type: Boolean, default: false } });
const emit = defineEmits(['close', 'connected']);

const apiKey = ref('');
const error = ref(null);
const busy = ref(false);

watch(
  () => props.open,
  () => {
    apiKey.value = '';
    error.value = null;
    busy.value = false;
  },
);

async function submit() {
  busy.value = true;
  error.value = null;
  try {
    const connection = await connectIntervals(apiKey.value.trim());
    apiKey.value = '';
    emit('connected', connection);
  } catch (err) {
    error.value =
      err.code === 'INVALID_KEY' ? 'intervals.icu no acepta esa clave: revísala.' : err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal :open="open" title="Conectar intervals.icu" @close="emit('close')">
    <form id="intervals-form" class="form" @submit.prevent="submit">
      <p class="secondary intro">
        Con tu clave personal de la API: en intervals.icu, <strong>Settings</strong> → abajo del
        todo, <strong>Developer Settings</strong> → <strong>API Key</strong>. Se comprueba antes de
        guardarla y se guarda cifrada.
      </p>
      <label class="field">
        <span>API Key</span>
        <PasswordInput v-model="apiKey" autocomplete="off" />
      </label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </form>

    <p class="note muted">
      <KeyRound class="icon icon-sm" />
      Se traen las actividades (con su TSS) y la forma y fatiga (CTL/ATL) de los últimos dos años.
    </p>

    <template #footer>
      <button class="btn" type="button" @click="emit('close')">Cancelar</button>
      <button
        class="btn btn-primary"
        type="submit"
        form="intervals-form"
        :disabled="busy || !apiKey.trim()"
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
