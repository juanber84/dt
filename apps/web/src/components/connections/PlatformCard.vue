<script setup>
import { ChevronRight } from '@lucide/vue';
import PlatformLogo from './PlatformLogo.vue';
import StatusPill from '../ui/StatusPill.vue';
import { STATES } from '../../data/platforms.js';

/** Tarjeta del catálogo; `pill` (si hay conexión) manda sobre el estado de la plataforma. */
defineProps({
  platform: { type: Object, required: true },
  pill: { type: Object, default: null }, // { tone, label }
  viaName: { type: String, default: '' },
});
</script>

<template>
  <RouterLink :to="`/admin/connections/${platform.id}`" class="platform card">
    <PlatformLogo :platform="platform" :size="44" />
    <div class="text">
      <strong>{{ platform.name }}</strong>
      <span class="tagline secondary">{{ platform.tagline }}</span>
      <span class="state">
        <StatusPill v-if="pill" :tone="pill.tone" :label="pill.label" />
        <span v-else class="muted">{{
          platform.state === 'via' && viaName
            ? `A través de ${viaName}`
            : STATES[platform.state].label
        }}</span>
      </span>
    </div>
    <ChevronRight class="icon icon-sm chevron" />
  </RouterLink>
</template>

<style scoped>
.platform {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 14px;
  padding: 16px;
  color: inherit;
  text-decoration: none;
  transition:
    border-color 0.15s,
    transform 0.15s;
}

.platform:hover {
  border-color: var(--border-strong);
  transform: translateY(-1px);
}

.text {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.tagline {
  font-size: 13px;
}

.state {
  margin-top: 4px;
  font-size: 12px;
}

.chevron {
  color: var(--muted);
}
</style>
