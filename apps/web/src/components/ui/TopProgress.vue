<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import { isBusy } from '../../composables/useProgress.js';

// Solo si tarda: lo que llega en menos de esto no enseña nada (si no, parpadea en cada clic)
const SHOW_AFTER_MS = 150;

const width = ref(0);
const visible = ref(false);
let showTimer;
let trickle;
let hideTimer;

function start() {
  clearTimeout(hideTimer);
  showTimer = setTimeout(() => {
    visible.value = true;
    width.value = 8;
    // Avanza cada vez más despacio sin llegar al final hasta que termine de verdad
    trickle = setInterval(() => (width.value += (90 - width.value) * 0.08), 200);
  }, SHOW_AFTER_MS);
}

function finish() {
  clearTimeout(showTimer);
  clearInterval(trickle);
  if (!visible.value) return;
  width.value = 100;
  hideTimer = setTimeout(() => {
    visible.value = false;
    width.value = 0;
  }, 250);
}

watch(isBusy, (busy) => (busy ? start() : finish()), { immediate: true });
onBeforeUnmount(() => [showTimer, trickle, hideTimer].forEach(clearTimeout));
</script>

<template>
  <div
    class="top-progress"
    :class="{ visible }"
    role="progressbar"
    aria-label="Cargando"
    :aria-hidden="!visible"
  >
    <span :style="{ width: `${width}%` }" />
  </div>
</template>

<style scoped>
.top-progress {
  position: fixed;
  top: env(safe-area-inset-top);
  left: 0;
  right: 0;
  z-index: 101;
  height: 2px;
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
}

.top-progress.visible {
  opacity: 1;
}

.top-progress span {
  display: block;
  height: 100%;
  background: var(--text);
  transition: width 0.2s ease-out;
}
</style>
