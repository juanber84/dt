<script setup>
import { ref } from 'vue';
import { Eye, EyeOff } from '@lucide/vue';

/** Campo de contraseña con el ojo para verla y aviso de Bloq Mayús. */
const model = defineModel({ type: String, default: '' });
defineProps({
  name: { type: String, default: 'password' },
  autocomplete: { type: String, default: 'current-password' },
  required: { type: Boolean, default: true },
});

const visible = ref(false);
const capsLock = ref(false);
const onKey = (event) => (capsLock.value = event.getModifierState?.('CapsLock') ?? false);
</script>

<template>
  <span class="password">
    <input
      v-model="model"
      class="input"
      :type="visible ? 'text' : 'password'"
      :name="name"
      :autocomplete="autocomplete"
      autocapitalize="off"
      spellcheck="false"
      :required="required"
      @keydown="onKey"
      @keyup="onKey"
    />
    <button
      type="button"
      class="reveal"
      :title="visible ? 'Ocultar contraseña' : 'Mostrar contraseña'"
      :aria-label="visible ? 'Ocultar contraseña' : 'Mostrar contraseña'"
      :aria-pressed="visible"
      @click="visible = !visible"
    >
      <EyeOff v-if="visible" class="icon icon-sm" />
      <Eye v-else class="icon icon-sm" />
    </button>
  </span>
  <small v-if="capsLock" class="caps">Bloq Mayús está activado</small>
</template>

<style scoped>
.password {
  position: relative;
  display: block;
}

.password .input {
  width: 100%;
  padding-right: 44px;
}

.reveal {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: grid;
  place-items: center;
  width: 42px;
  border: 0;
  background: none;
  color: var(--muted);
  cursor: pointer;
}

.reveal:hover {
  color: var(--text);
}

.caps {
  font-size: 12px;
  color: var(--warning-text);
}
</style>
