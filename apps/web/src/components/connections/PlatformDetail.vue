<script setup>
import { computed } from 'vue';
import { ArrowLeft, ArrowRight, ExternalLink, Globe, Smartphone } from '@lucide/vue';
import PlatformLogo from './PlatformLogo.vue';
import StatusPill from '../ui/StatusPill.vue';
import { CATEGORIES, CONNECTION_STATUS, STATES, platformById } from '../../data/platforms.js';
import { DATA_TYPES } from '../../data/sources.js';

/**
 * Ficha de una plataforma: qué es, qué datos da, cómo llega a TwinMe y dónde conseguirla. El estado
 * de tu conexión (y sus botones) va en el slot.
 */
const props = defineProps({
  platform: { type: Object, required: true },
  // Se conecta aquí (o es el bot): entonces el slot lleva su estado y sus botones
  connectable: { type: Boolean, default: false },
  // La pastilla de conexión de otra plataforma (para las que llegan a través de ella)
  pillFor: { type: Function, default: () => null },
});

const color = computed(() => props.platform.icon?.color ?? props.platform.color);
const via = computed(() => (props.platform.via ?? []).map(platformById).filter(Boolean));
const state = computed(() =>
  props.platform.state === 'via' && via.value.length
    ? { ...STATES.via, label: `A través de ${via.value.map((p) => p.name).join(' o ')}` }
    : STATES[props.platform.state],
);

// Con enlace de invitación (referral), ese va primero
const links = computed(() => {
  const l = props.platform.links ?? {};
  return [
    l.referral && { href: l.referral, label: `Conseguir ${props.platform.name}`, icon: ArrowRight },
    l.ios && { href: l.ios, label: 'App Store', icon: Smartphone },
    l.android && { href: l.android, label: 'Google Play', icon: Smartphone },
    l.web && { href: l.web, label: 'Web', icon: Globe },
  ].filter(Boolean);
});
</script>

<template>
  <article class="detail">
    <RouterLink to="/admin/connections" class="back muted">
      <ArrowLeft class="icon icon-sm" /> Conexiones
    </RouterLink>

    <header class="hero card" :style="color && { '--brand': color }">
      <PlatformLogo :platform="platform" :size="72" />
      <div class="title">
        <p class="section-label">{{ CATEGORIES[platform.category].label }}</p>
        <h1>{{ platform.name }}</h1>
        <p class="tagline">{{ platform.tagline }}</p>
        <StatusPill :tone="state.tone" :label="state.label" />
      </div>
    </header>

    <p class="description">{{ platform.description }}</p>

    <section v-if="connectable" class="block">
      <h2 class="sub">Tu conexión</h2>
      <div class="card pad"><slot /></div>
    </section>

    <section v-if="via.length" class="block">
      <h2 class="sub">Cómo llega</h2>
      <div class="card pad flow">
        <div class="steps">
          <span class="step"><PlatformLogo :platform="platform" :size="32" /></span>
          <ArrowRight class="icon icon-sm muted" />
          <template v-for="v in via" :key="v.id">
            <RouterLink :to="`/admin/connections/${v.id}`" class="step">
              <PlatformLogo :platform="v" :size="32" />
            </RouterLink>
            <ArrowRight class="icon icon-sm muted" />
          </template>
          <span class="step twinme">TwinMe</span>
        </div>
        <p v-if="platform.how" class="secondary how">{{ platform.how }}</p>
        <RouterLink
          v-for="v in via"
          :key="v.id"
          :to="`/admin/connections/${v.id}`"
          class="via-status"
        >
          <span>Tu {{ v.name }}</span>
          <StatusPill
            :tone="(pillFor(v) ?? CONNECTION_STATUS.disconnected).tone"
            :label="(pillFor(v) ?? CONNECTION_STATUS.disconnected).label"
          />
        </RouterLink>
      </div>
    </section>

    <section class="block">
      <h2 class="sub">Qué datos da</h2>
      <div class="types">
        <span v-for="t in platform.provides" :key="t" class="chip">{{ DATA_TYPES[t] ?? t }}</span>
      </div>
    </section>

    <section v-if="links.length" class="block">
      <h2 class="sub">Dónde conseguirla</h2>
      <div class="links">
        <a
          v-for="(l, i) in links"
          :key="l.href"
          :href="l.href"
          target="_blank"
          rel="noopener"
          class="btn"
          :class="{ 'btn-primary': i === 0 && platform.links.referral }"
        >
          <component :is="l.icon" class="icon icon-sm" />
          {{ l.label }}
          <ExternalLink class="icon icon-sm muted" />
        </a>
      </div>
    </section>
  </article>
</template>

<style scoped>
.detail {
  display: grid;
  gap: 20px;
}

.back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  font-size: 13px;
  text-decoration: none;
}

/* Un halo con el color de la marca (si lo tiene) detrás del logo */
.hero {
  --brand: var(--text-2);
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 28px 24px;
  background:
    radial-gradient(
      120% 140% at 0% 0%,
      color-mix(in srgb, var(--brand) 22%, transparent),
      transparent 60%
    ),
    var(--surface);
}

.title {
  display: grid;
  justify-items: start;
  gap: 4px;
  min-width: 0;
}

.title h1 {
  margin: 0;
}

.tagline {
  margin-bottom: 6px;
  color: var(--text-2);
}

.description {
  max-width: 640px;
  color: var(--text-2);
}

.block {
  display: grid;
  gap: 10px;
}

.sub {
  margin: 0;
  font-size: 15px;
}

.pad {
  padding: 16px;
}

.flow {
  display: grid;
  gap: 12px;
}

.steps {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.step {
  display: inline-flex;
}

.twinme {
  align-items: center;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  background: var(--text);
  color: var(--inverse);
  font-size: 13px;
  font-weight: 650;
}

.how {
  font-size: 13px;
}

.via-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  font-size: 13px;
  color: inherit;
  text-decoration: none;
}

.types {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 12px;
}

.links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.links .btn {
  gap: 6px;
}

@media (max-width: 600px) {
  .hero {
    flex-direction: column;
    align-items: flex-start;
    padding: 22px 18px;
  }
}
</style>
