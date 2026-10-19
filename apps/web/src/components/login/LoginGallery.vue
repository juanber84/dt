<script setup>
import { onMounted, onUnmounted, ref } from 'vue';

/**
 * Fondo del login: fotos de lo que mide la app (entreno, sueño, comida, recuperación, gente) que
 * se funden una en otra con un zoom lento, con su etiqueta y barras de progreso. Fotos CC0 en
 * public/login (ver CREDITS.md). Con "reducir movimiento" se queda la primera, quieta.
 */
const SLIDES = [
  {
    src: '/login/montana.jpg',
    label: 'Entreno',
    text: 'Cada salida, con su carga.',
    color: '#eb6834',
  },
  { src: '/login/sueno.jpg', label: 'Sueño', text: 'Cada noche, fase a fase.', color: '#3987e5' },
  {
    src: '/login/desayuno.jpg',
    label: 'Nutrición',
    text: 'Cada comida, al momento.',
    color: '#1baf7a',
  },
  { src: '/login/niebla.jpg', label: 'Pulso', text: 'Cada latido, todo el día.', color: '#eb6834' },
  {
    src: '/login/estirar.jpg',
    label: 'Recuperación',
    text: 'Cuándo apretar y cuándo parar.',
    color: '#3987e5',
  },
  {
    src: '/login/charla.jpg',
    label: 'Tu vida',
    text: 'Lo que pasa fuera también cuenta.',
    color: '#c3c2b7',
  },
  {
    src: '/login/carretera.jpg',
    label: 'Constancia',
    text: 'Todos tus días, juntos.',
    color: '#1baf7a',
  },
];
const DURATION_MS = 6500;

const current = ref(0);
const loaded = ref(new Set([0]));
let timer;

function go(index) {
  current.value = (index + SLIDES.length) % SLIDES.length;
  // Se carga la siguiente con antelación para que el fundido no espere
  loaded.value = new Set([...loaded.value, current.value, (current.value + 1) % SLIDES.length]);
}

onMounted(() => {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  go(0);
  timer = setInterval(() => go(current.value + 1), DURATION_MS);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="gallery" aria-hidden="true">
    <div
      v-for="(s, i) in SLIDES"
      :key="s.src"
      class="slide"
      :class="{ active: i === current }"
      :style="loaded.has(i) ? { backgroundImage: `url(${s.src})` } : null"
    />
    <div class="veil" />

    <div class="caption">
      <!-- La clave cambia con la foto: el texto entra animado (sin esperar a que salga el anterior) -->
      <p :key="current" class="line">
        <span class="dot" :style="{ background: SLIDES[current].color }" />
        <strong>{{ SLIDES[current].label }}</strong>
        <span class="text">{{ SLIDES[current].text }}</span>
      </p>
      <div class="bars">
        <span
          v-for="(s, i) in SLIDES"
          :key="s.src"
          class="bar"
          :class="{ done: i < current, active: i === current }"
          :style="{ '--duration': `${DURATION_MS}ms` }"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.gallery {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.slide {
  position: absolute;
  inset: -2%;
  background-position: center;
  background-size: cover;
  opacity: 0;
  transform: scale(1.02);
  transition:
    opacity 1.6s ease,
    transform 8s ease-out;
}

.slide.active {
  opacity: 1;
  transform: scale(1.1);
}

/* Velo: oscuro a la izquierda (el titular) y abajo, con un toque del degradado de la marca */
.veil {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(
      90deg,
      rgba(8, 9, 11, 0.94) 0%,
      rgba(8, 9, 11, 0.7) 40%,
      rgba(8, 9, 11, 0.45) 100%
    ),
    linear-gradient(0deg, rgba(8, 9, 11, 0.9) 0%, rgba(8, 9, 11, 0) 40%),
    linear-gradient(135deg, rgba(57, 135, 229, 0.18), rgba(235, 104, 52, 0.12));
}

.caption {
  position: absolute;
  left: 48px;
  bottom: 40px;
  display: grid;
  gap: 12px;
  width: min(420px, calc(100% - 96px));
}

.caption p {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: rgba(244, 243, 239, 0.9);
}

.caption strong {
  font-weight: 650;
}

.caption .text {
  color: rgba(244, 243, 239, 0.6);
}

.dot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
}

.bars {
  display: flex;
  gap: 6px;
}

.bar {
  position: relative;
  flex: 1;
  height: 2px;
  overflow: hidden;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.18);
}

.bar::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.9);
  transform: scaleX(0);
  transform-origin: left;
}

.bar.done::after {
  transform: scaleX(1);
}

.bar.active::after {
  animation: fill var(--duration) linear forwards;
}

@keyframes fill {
  to {
    transform: scaleX(1);
  }
}

.line {
  animation: rise 0.5s ease both;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

@media (max-width: 960px) {
  .caption {
    display: none;
  }

  .veil {
    background:
      linear-gradient(
        0deg,
        rgba(8, 9, 11, 0.96) 0%,
        rgba(8, 9, 11, 0.75) 55%,
        rgba(8, 9, 11, 0.55) 100%
      ),
      linear-gradient(135deg, rgba(57, 135, 229, 0.18), rgba(235, 104, 52, 0.12));
  }
}

@media (prefers-reduced-motion: reduce) {
  .slide {
    transition: none;
    transform: none;
  }

  .bars {
    display: none;
  }

  .line {
    animation: none;
  }
}
</style>
