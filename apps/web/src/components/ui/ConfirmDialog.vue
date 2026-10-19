<script setup>
import { nextTick, ref, watch } from 'vue';
import Modal from './Modal.vue';
import { useConfirm } from '../../composables/useConfirm.js';

/** La confirmación de useConfirm(). Va una vez en App.vue. */
const { request, answer } = useConfirm();
const confirmButton = ref(null);

// El foco va al botón de confirmar: Enter confirma, Escape cancela
watch(request, (value) => value && nextTick(() => confirmButton.value?.focus()));
</script>

<template>
  <Modal :open="Boolean(request)" :title="request?.title ?? ''" :width="400" @close="answer(false)">
    <p v-if="request?.message" class="message">{{ request.message }}</p>
    <template #footer>
      <button class="btn" @click="answer(false)">Cancelar</button>
      <button
        ref="confirmButton"
        class="btn"
        :class="request?.danger ? 'btn-danger' : 'btn-primary'"
        @click="answer(true)"
      >
        {{ request?.confirmLabel }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.message {
  margin: 0;
  color: var(--text-2);
  line-height: 1.5;
}
</style>
