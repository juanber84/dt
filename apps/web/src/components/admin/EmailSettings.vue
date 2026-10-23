<script setup>
import { onMounted, ref } from 'vue';
import { Mail, Send } from '@lucide/vue';
import { useToast } from '../../composables/useToast.js';
import { fetchEmail, sendTestEmail } from '../../services/email.js';
import { fmtRelativeTime } from '../../lib/format.js';

const toast = useToast();
const info = ref(null); // null: aún no / el servidor no tiene correo (404)
const loaded = ref(false);
const busy = ref(false);

async function load() {
  info.value = await fetchEmail().catch(() => null);
  loaded.value = true;
}
onMounted(load);

async function test() {
  busy.value = true;
  try {
    await sendTestEmail();
    toast.show(`Enviado a ${info.value.to}: mira tu bandeja de entrada`);
  } catch (err) {
    toast.show(err.message, 'critical');
  } finally {
    busy.value = false;
    await load();
  }
}

const STATUS = { sent: 'Enviado', pending: 'Enviando', failed: 'Falló' };
</script>

<template>
  <section class="email">
    <h2 class="sub">Correo</h2>
    <p class="secondary sub-desc">
      Por aquí te llegará el informe de cada mañana. Prueba que llega y que no cae en spam.
    </p>

    <p v-if="loaded && !info" class="muted">El servidor aún no tiene el correo configurado.</p>

    <template v-else-if="info">
      <div class="card status">
        <Mail class="icon" />
        <div class="text">
          <strong>{{ info.to }}</strong>
          <span class="muted">El correo de tu cuenta</span>
        </div>
        <div class="actions">
          <button class="btn" :disabled="busy" @click="test">
            <Send class="icon icon-sm" /> {{ busy ? 'Enviando…' : 'Probar' }}
          </button>
        </div>
      </div>

      <template v-if="info.history.length">
        <h3 class="sub-sm">Últimos correos</h3>
        <ul class="card history">
          <li v-for="h in info.history.slice(0, 5)" :key="h.id">
            <span class="text">
              <strong>{{ h.subject }}</strong>
              <span :class="h.status === 'failed' ? 'critical' : 'muted'">
                {{ STATUS[h.status] ?? h.status }}{{ h.error ? ` · ${h.error}` : '' }}
              </span>
            </span>
            <span class="muted when">{{ fmtRelativeTime(h.sentAt ?? h.createdAt) }}</span>
          </li>
        </ul>
      </template>
    </template>
  </section>
</template>

<style scoped>
.sub {
  margin: 32px 0 4px;
  font-size: 15px;
}

.sub-desc {
  margin-bottom: 12px;
  font-size: 13px;
}

.sub-sm {
  margin: 20px 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
}

.status {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
}

.text {
  display: grid;
  gap: 2px;
  flex: 1;
  min-width: 0;
  font-size: 13px;
}

.text strong {
  font-size: 14px;
  overflow-wrap: anywhere;
}

.actions {
  display: flex;
  gap: 6px;
  flex: none;
}

.history {
  margin: 0;
  padding: 0;
  list-style: none;
}

.history li + li {
  border-top: 1px solid var(--border);
}

.history li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  font-size: 12px;
}

.history .text strong {
  font-size: 13px;
}

.when {
  flex: none;
}

.critical {
  color: var(--critical-text);
}
</style>
