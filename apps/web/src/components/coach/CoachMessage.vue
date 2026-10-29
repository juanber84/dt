<script setup>
import { ChartLine, CircleAlert, Database, Dumbbell, LoaderCircle } from '@lucide/vue';
import CoachChart from './CoachChart.vue';
import CoachTemplateCard from './CoachTemplateCard.vue';
import Markdown from './Markdown.vue';
import { answerParts, toolLabel } from '../../services/coach.js';
import { formatShortDate } from '../../lib/dates.js';

/**
 * Un mensaje del hilo: la pregunta (con el día por el que se pregunta) o la respuesta, con los
 * datos que ha consultado, su texto, sus gráficas y las plantillas que propone, en orden. Mientras llega (`live`) y no hay
 * texto ni herramienta en marcha, los puntos de "pensando".
 */
defineProps({ message: { type: Object, required: true } });
</script>

<template>
  <div v-if="message.role === 'user'" class="msg user">
    <span v-if="message.context?.date" class="ctx"
      >Sobre el {{ formatShortDate(message.context.date) }}</span
    >
    <p>{{ message.content }}</p>
  </div>
  <div v-else class="msg assistant">
    <ul v-if="message.tools.length" class="tools" aria-label="Datos consultados">
      <li v-for="t in message.tools" :key="t.id" :class="{ failed: t.ok === false }">
        <LoaderCircle v-if="t.ok === null" class="icon icon-sm spin" />
        <ChartLine v-else-if="t.name === 'show_chart'" class="icon icon-sm" />
        <Dumbbell v-else-if="t.name === 'propose_strength_template'" class="icon icon-sm" />
        <Database v-else class="icon icon-sm" />
        {{ toolLabel(t.name, t.args) }}
      </li>
    </ul>
    <template v-for="part in answerParts(message)" :key="part.key">
      <CoachChart v-if="part.type === 'chart'" :chart="part.chart" />
      <CoachTemplateCard v-else-if="part.type === 'template'" :entry="part.entry" />
      <Markdown v-else :source="part.text" />
    </template>
    <span
      v-if="!message.content && message.live && !message.tools.some((t) => t.ok === null)"
      class="thinking"
    >
      <span /><span /><span />
    </span>
    <p v-if="message.stopped" class="muted note">Respuesta cortada.</p>
    <p v-if="message.error" class="error" role="alert">
      <CircleAlert class="icon icon-sm" />
      {{ message.error }}
    </p>
  </div>
</template>

<style scoped>
.msg {
  max-width: 720px;
  width: 100%;
}

.msg.user {
  align-self: flex-end;
  width: auto;
  max-width: min(560px, 85%);
  display: grid;
  justify-items: end;
  gap: 4px;
}

.msg.user p {
  margin: 0;
  padding: 9px 14px;
  border-radius: 16px 16px 4px 16px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.ctx {
  font-size: 11px;
  color: var(--muted);
}

.msg.assistant {
  align-self: flex-start;
  display: grid;
  gap: 8px;
}

.tools {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tools li {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 11px;
  color: var(--muted);
}

.tools li.failed {
  color: var(--critical-text);
  border-color: color-mix(in srgb, var(--critical) 30%, transparent);
}

.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.thinking {
  display: inline-flex;
  gap: 4px;
  padding: 6px 0;
}

.thinking span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--muted);
  animation: pulse 1.2s ease-in-out infinite;
}

.thinking span:nth-child(2) {
  animation-delay: 0.15s;
}

.thinking span:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes pulse {
  0%,
  80%,
  100% {
    opacity: 0.25;
  }
  40% {
    opacity: 1;
  }
}

.note {
  margin: 0;
  font-size: 12px;
}

.error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 13px;
  color: var(--critical-text);
}
</style>
