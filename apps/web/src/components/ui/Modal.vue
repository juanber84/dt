<script setup>
import { onBeforeUnmount, watch } from 'vue';
import { X } from '@lucide/vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, required: true },
  width: { type: Number, default: 440 },
});
const emit = defineEmits(['close']);

const onKey = (e) => e.key === 'Escape' && emit('close');
watch(
  () => props.open,
  (open) => (open ? addEventListener('keydown', onKey) : removeEventListener('keydown', onKey)),
);
onBeforeUnmount(() => removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <Transition name="pop">
      <div v-if="open" class="backdrop" @click.self="emit('close')">
        <div
          class="modal card"
          :style="{ width: `min(${width}px, calc(100vw - 32px))` }"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
        >
          <header>
            <h2>{{ title }}</h2>
            <button
              class="btn btn-ghost btn-icon btn-sm"
              aria-label="Cerrar"
              @click="emit('close')"
            >
              <X class="icon icon-sm" />
            </button>
          </header>
          <div class="body"><slot /></div>
          <footer v-if="$slots.footer"><slot name="footer" /></footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: var(--overlay);
}

.modal {
  box-shadow: var(--shadow);
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 0;
}

.body {
  padding: 16px 18px;
  display: grid;
  gap: 14px;
}

footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 18px;
  border-top: 1px solid var(--border);
}

.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.16s ease;
}

.pop-enter-active .modal,
.pop-leave-active .modal {
  transition: transform 0.16s ease;
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
}

.pop-enter-from .modal {
  transform: translateY(6px) scale(0.99);
}
</style>
