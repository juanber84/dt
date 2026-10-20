<script setup>
import { useToast } from '../../composables/useToast.js';

const { message, hide } = useToast();
</script>

<template>
  <Teleport to="body">
    <Transition name="toast">
      <div v-if="message" :key="message.id" class="toast" :class="message.tone" role="status">
        {{ message.text }}
        <RouterLink v-if="message.action" :to="message.action.to" class="action" @click="hide">
          {{ message.action.label }}
        </RouterLink>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.action {
  margin-left: 10px;
  font-weight: 600;
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.toast {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 60;
  max-width: 360px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--text);
  color: var(--inverse);
  font-size: 13px;
  box-shadow: var(--shadow);
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

@media (max-width: 860px) {
  .toast {
    left: 16px;
    right: 16px;
    bottom: calc(76px + env(safe-area-inset-bottom));
  }
}
</style>
