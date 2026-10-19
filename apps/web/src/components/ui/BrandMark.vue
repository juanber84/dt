<script setup>
/**
 * La marca: un latido y su reflejo (tú y tu gemelo) sobre el degradado de la app, del azul del
 * sueño al naranja del esfuerzo. El mismo dibujo está en public/favicon.svg.
 */
defineProps({ size: { type: Number, default: 24 } });
const id = `bm-${Math.random().toString(36).slice(2, 8)}`;
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 32 32" aria-hidden="true" class="brand-mark">
    <defs>
      <linearGradient :id="id" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#3987e5" />
        <stop offset="55%" stop-color="#7a5fd0" />
        <stop offset="100%" stop-color="#eb6834" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="9" :fill="`url(#${id})`" />
    <path
      d="M4.5 13H10l2-4 2.5 8 3-12 2.5 8h7.5"
      fill="none"
      stroke="#fff"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      d="M4.5 19H10l2 4 2.5-8 3 12 2.5-8h7.5"
      fill="none"
      stroke="#fff"
      stroke-opacity="0.4"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<style scoped>
.brand-mark {
  display: block;
  flex: none;
}
</style>
