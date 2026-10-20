<script setup>
import { onBeforeUnmount, watch } from 'vue';
import { X } from '@lucide/vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  width: { type: Number, default: 460 },
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
    <Transition name="fade">
      <div v-if="open" class="overlay" @click="emit('close')" />
    </Transition>
    <Transition name="slide">
      <aside
        v-if="open"
        class="drawer"
        :style="{ width: `min(${width}px, 100vw)` }"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <header>
          <slot name="header">
            <h2>{{ title }}</h2>
          </slot>
          <button class="btn btn-ghost btn-icon" aria-label="Cerrar" @click="emit('close')">
            <X class="icon" />
          </button>
        </header>
        <div class="body"><slot /></div>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: var(--overlay);
}

.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 41;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-left: 1px solid var(--border);
  box-shadow: var(--shadow);
}

header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--border);
}

.body {
  flex: 1;
  overflow-y: auto;
  padding: 18px 20px 28px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}

/* En el móvil, hoja que sube desde abajo (como en iOS) en vez de panel lateral */
@media (max-width: 860px) {
  .drawer {
    top: auto;
    left: 0;
    width: 100% !important;
    max-height: calc(100dvh - max(24px, env(safe-area-inset-top)) - 12px);
    border-left: 0;
    border-top: 1px solid var(--border);
    border-radius: 16px 16px 0 0;
  }

  /* Asa para indicar que es una hoja */
  .drawer::before {
    content: '';
    align-self: center;
    flex: none;
    width: 36px;
    height: 5px;
    margin-top: 8px;
    border-radius: 3px;
    background: var(--border-strong);
  }

  header {
    padding: 10px 16px 12px;
  }

  .body {
    padding: 16px 16px calc(24px + env(safe-area-inset-bottom));
  }

  .slide-enter-from,
  .slide-leave-to {
    transform: translateY(100%);
  }
}
</style>
