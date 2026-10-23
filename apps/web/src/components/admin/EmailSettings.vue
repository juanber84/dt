<script setup>
import { onMounted, ref } from 'vue';
import { ChevronRight, FileText, Mail, Send } from '@lucide/vue';
import { useToast } from '../../composables/useToast.js';
import { fetchEmail, sendTestEmail } from '../../services/email.js';
import { fetchReportSettings, saveReportSettings, sendDailyNow } from '../../services/reports.js';
import { fmtRelativeTime } from '../../lib/format.js';

const toast = useToast();
const info = ref(null); // null: aún no / el servidor no tiene correo (404)
const reports = ref(null); // preferencias del informe de la mañana (null: sin informes)
const loaded = ref(false);
const busy = ref(false);
const sending = ref(false);

async function load() {
  [info.value, reports.value] = await Promise.all([
    fetchEmail().catch(() => null),
    fetchReportSettings().catch(() => null),
  ]);
  loaded.value = true;
}
onMounted(load);

async function saveReports(patch) {
  try {
    reports.value = await saveReportSettings(patch);
  } catch (err) {
    toast.show(`No se ha guardado (${err.message})`, 'critical');
  }
}

async function dailyNow() {
  sending.value = true;
  try {
    const { email } = await sendDailyNow();
    if (email.status === 'sent') toast.show(`Te lo hemos mandado a ${info.value.to}`);
    else if (email.status === 'failed')
      toast.show(`Hecho, pero el correo falló: ${email.error}`, 'critical');
    else toast.show('Hecho: lo tienes en Informes');
  } catch (err) {
    toast.show(err.message, 'critical');
  } finally {
    sending.value = false;
    await load();
  }
}

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
      A qué correo te llegan, el informe de cada mañana y una prueba para ver que no cae en spam.
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

      <template v-if="reports">
        <h3 class="sub-sm">Informe de la mañana</h3>
        <div class="card daily">
          <label class="row">
            <span class="text">
              <strong>Mandármelo cada mañana</strong>
              <span class="muted"
                >Lo de ayer (comida, peso, sueño, entreno, salud) y qué hacer hoy.</span
              >
            </span>
            <input
              type="checkbox"
              role="switch"
              class="switch"
              :checked="reports.dailyEnabled"
              @change="saveReports({ dailyEnabled: $event.target.checked })"
            />
          </label>
          <label v-if="reports.dailyEnabled" class="row">
            <span class="text">
              <strong>A qué hora</strong>
              <span class="muted"
                >El sueño de anoche llega cuando el reloj sincroniza: si lo pones muy temprano,
                puede faltar.</span
              >
            </span>
            <input
              class="input time"
              type="time"
              :value="reports.dailyTime"
              @change="saveReports({ dailyTime: $event.target.value })"
            />
          </label>
          <div class="row">
            <span class="text">
              <strong>El de ayer, ahora</strong>
              <span class="muted">Lo hace al momento y te lo manda (tarda unos segundos).</span>
            </span>
            <button class="btn" :disabled="sending" @click="dailyNow">
              <Send class="icon icon-sm" /> {{ sending ? 'Haciéndolo…' : 'Mandar' }}
            </button>
          </div>
          <RouterLink to="/reports" class="row link">
            <FileText class="icon" />
            <span class="text"><strong>Ver todos los informes</strong></span>
            <ChevronRight class="icon icon-sm muted" />
          </RouterLink>
        </div>
      </template>

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

.daily .row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
}

.daily .row + .row {
  border-top: 1px solid var(--border);
}

.daily .link {
  color: inherit;
  text-decoration: none;
}

.time {
  width: auto;
  flex: none;
}

/* Interruptor a partir de un checkbox (role="switch"), como en Notificaciones */
.switch {
  appearance: none;
  position: relative;
  flex: none;
  width: 42px;
  height: 26px;
  margin: 0;
  border-radius: 13px;
  background: var(--border-strong);
  cursor: pointer;
  transition: background 0.15s;
}

.switch::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  transition: transform 0.15s;
}

.switch:checked {
  background: var(--good);
}

.switch:checked::after {
  transform: translateX(16px);
}

.switch:focus-visible {
  outline: 2px solid var(--text);
  outline-offset: 2px;
}
</style>
