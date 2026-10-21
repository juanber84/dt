<script setup>
/** Hueco gris con brillo mientras carga, con la forma de lo que va a salir. */
defineProps({
  width: { type: String, default: '100%' },
  height: { type: String, default: '12px' },
  radius: { type: String, default: '6px' },
  circle: { type: Boolean, default: false },
});
</script>

<template>
  <span
    class="skeleton"
    aria-hidden="true"
    :style="{
      width: circle ? height : width,
      height,
      borderRadius: circle ? '50%' : radius,
    }"
  />
</template>

<style scoped>
.skeleton {
  display: block;
  flex: none;
  max-width: 100%;
  background:
    linear-gradient(
        90deg,
        transparent 0%,
        color-mix(in srgb, var(--text) 6%, transparent) 50%,
        transparent 100%
      )
      0 0 / 200% 100% no-repeat,
    var(--surface-2);
  animation: shimmer 1.4s ease-in-out infinite;
}

@keyframes shimmer {
  from {
    background-position:
      150% 0,
      0 0;
  }
  to {
    background-position:
      -50% 0,
      0 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton {
    animation: none;
  }
}
</style>
