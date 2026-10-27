<script setup>
import { computed } from 'vue';

/** El logo de una plataforma: su SVG, su icono en blanco sobre su color o, si no, el monograma. */
const props = defineProps({
  platform: { type: Object, required: true },
  size: { type: Number, default: 40 },
});

const color = computed(() => props.platform.icon?.color ?? props.platform.color);
// Marcas negras: en oscuro necesitan borde para no perderse en el fondo
const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  borderRadius: `${Math.round(props.size * 0.24)}px`,
  fontSize: `${Math.round(props.size * 0.38)}px`,
  ...(color.value && { background: color.value, color: '#fff' }),
}));
</script>

<template>
  <span
    class="logo"
    :class="{ branded: Boolean(color), 'has-logo': Boolean(platform.logo) }"
    :style="style"
    role="img"
    :aria-label="platform.name"
  >
    <img v-if="platform.logo" :src="platform.logo" alt="" loading="lazy" />
    <svg
      v-else-if="platform.icon"
      viewBox="0 0 24 24"
      :style="{ width: `${(platform.icon.scale ?? 0.56) * 100}%` }"
      aria-hidden="true"
    >
      <path :d="platform.icon.path" fill="currentColor" />
    </svg>
    <template v-else>{{ platform.monogram }}</template>
  </span>
</template>

<style scoped>
.logo {
  display: inline-grid;
  place-items: center;
  flex: none;
  overflow: hidden;
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  color: var(--text-2);
  font-weight: 700;
  letter-spacing: -0.03em;
}

.branded {
  border-color: color-mix(in srgb, var(--text) 12%, transparent);
}

svg {
  height: auto;
}

.has-logo {
  background: none;
}

img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
