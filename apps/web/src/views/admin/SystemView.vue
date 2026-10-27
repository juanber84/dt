<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import {
  RefreshCw,
  Server,
  Database,
  Bot,
  Cog,
  BrainCircuit,
  HardDriveDownload,
} from '@lucide/vue';
import AdminHeader from '../../components/admin/AdminHeader.vue';
import StatusPill from '../../components/ui/StatusPill.vue';
import Segmented from '../../components/ui/Segmented.vue';
import { fetchSystemActivity, fetchSystemStatus } from '../../services/twin.js';
import { fmtDec, fmtDuration, fmtInt, fmtRelativeTime } from '../../lib/format.js';
import { balanceStatus, fetchAiStatus } from '../../services/ai.js';

const status = ref(null);
const error = ref(null);
const loading = ref(false);
const checkedAt = ref(null);
const ai = ref(null);
const activity = ref(null);
const jobFilter = ref('all');

function loadActivity() {
  const filter = JOB_FILTERS.find((f) => f.value === jobFilter.value);
  return fetchSystemActivity(filter.params)
    .then((value) => (activity.value = value))
    .catch(() => (activity.value = null));
}

watch(jobFilter, loadActivity);

async function check() {
  loading.value = true;
  fetchAiStatus()
    .then((value) => (ai.value = value))
    .catch(() => (ai.value = null));
  loadActivity();
  try {
    status.value = await fetchSystemStatus();
    error.value = null;
  } catch (err) {
    // 503 = la API responde pero algo (la BD) no
    status.value = null;
    error.value = err;
  } finally {
    loading.value = false;
    checkedAt.value = Date.now();
  }
}

onMounted(check);

// Con 503 la API también manda el informe (qué falla y qué servicios laten)
const report = computed(() => status.value ?? error.value?.body ?? null);

const bot = computed(() => {
  const beat = report.value?.services?.bot;
  if (!beat) {
    return {
      tone: 'neutral',
      label: 'Sin datos',
      text: report.value
        ? 'No ha dado señales desde que arrancó la API (late cada minuto).'
        : 'Sin conexión con la API.',
    };
  }
  const name = beat.username ? `@${beat.username}` : 'El bot';
  if (beat.status === 'stale') {
    return {
      tone: 'critical',
      label: 'Sin señal',
      text: `${name} no da señales desde ${fmtRelativeTime(beat.lastSeenAt)}.`,
    };
  }
  const minutes = (Date.now() - Date.parse(beat.startedAt)) / 60_000;
  return {
    tone: 'good',
    label: 'Funcionando',
    text: `${name} · en marcha desde hace ${fmtDuration(minutes)} · último latido ${fmtRelativeTime(beat.lastSeenAt)}`,
  };
});

const worker = computed(() => {
  const beat = report.value?.services?.worker;
  if (!beat) {
    return {
      tone: 'neutral',
      label: 'Sin datos',
      text: report.value?.checks?.db
        ? 'No ha dado señales en el último día (late cada 30 s).'
        : 'La API no tiene BD: sin BD no hay worker.',
    };
  }
  const jobs = Object.values(beat.stats?.jobs ?? {});
  const done = jobs.reduce((n, j) => n + j.done, 0);
  const failed = jobs.reduce((n, j) => n + j.failed, 0);
  if (beat.status === 'stale') {
    return {
      tone: 'critical',
      label: 'Sin señal',
      text: `No da señales desde ${fmtRelativeTime(beat.lastSeenAt)}.`,
    };
  }
  const minutes = (Date.now() - Date.parse(beat.startedAt)) / 60_000;
  return {
    tone: failed ? 'warning' : 'good',
    label: 'Funcionando',
    text: [
      `En marcha desde hace ${fmtDuration(minutes)}`,
      `${fmtInt(done)} trabajos hechos${failed ? `, ${fmtInt(failed)} fallidos` : ''}`,
      `último latido ${fmtRelativeTime(beat.lastSeenAt)}`,
      beat.instances > 1 ? `${beat.instances} instancias` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    lastError: beat.stats?.lastError,
  };
});

/** Qué hace cada cola, en el orden del pipeline. */
const QUEUES = [
  ['sync', 'Sincronizar', 'Traer lo nuevo de una conexión'],
  ['backfill', 'Carga inicial', 'Planificar el histórico al conectar'],
  ['fetch', 'Descargas', 'Un trozo (tipo + días) de Google'],
  ['normalize', 'Normalizar', 'Bruto → timeline'],
  ['scheduled-sync', 'Cron', 'Sincronizaciones programadas'],
  ['maintenance', 'Mantenimiento', 'Limpieza diaria'],
  ['clinical-extract', 'Informes médicos', 'Leer un PDF subido'],
  ['google-subscriber', 'Avisos de Google', 'Revisar el suscriptor de webhooks'],
  ['push', 'Notificaciones', 'Avisos al móvil'],
  ['db-backup', 'Copia de seguridad', 'La BD a Google Drive, cada noche'],
];
const QUEUE_NAMES = Object.fromEntries(QUEUES.map(([id, name]) => [id, name]));
const queues = computed(() => {
  const stats = report.value?.queues;
  if (!stats) return null;
  // Hechos en 24 h según el historial de la cola (sobrevive a los reinicios del worker)
  const counts = activity.value?.counts;
  const jobs = report.value?.services?.worker?.stats?.jobs ?? {};
  return QUEUES.map(([id, name, description]) => ({
    id,
    name,
    description,
    ...(stats[id] ?? { ready: 0, deferred: 0, active: 0, failed: 0 }),
    done: counts ? (counts[id]?.completed ?? 0) : (jobs[id]?.done ?? 0),
  }));
});

const llm = computed(() => balanceStatus(ai.value));

/** La última copia de seguridad: si hay, si salió bien y si es de hace menos de un día y medio. */
const backup = computed(() => {
  const last = activity.value?.backups?.[0];
  if (!activity.value) return { tone: 'neutral', label: 'Sin datos', text: 'Comprobando…' };
  if (!last) {
    return {
      tone: 'critical',
      label: 'Sin copias',
      text: 'Aún no se ha hecho ninguna copia de la base de datos.',
    };
  }
  if (last.status === 'running') {
    return {
      tone: 'neutral',
      label: 'Haciéndose',
      text: `Empezó ${fmtRelativeTime(last.startedAt)}`,
    };
  }
  if (last.status === 'error') {
    return {
      tone: 'critical',
      label: 'Falló',
      text: `${fmtRelativeTime(last.startedAt)}: ${last.error}`,
    };
  }
  const old = Date.now() - Date.parse(last.finishedAt) > 36 * 3600 * 1000;
  const mb = last.sizeBytes == null ? '' : ` · ${fmtDec(last.sizeBytes / 1024 / 1024, 1)} MB`;
  return {
    tone: old ? 'warning' : 'good',
    label: old ? 'Atrasada' : 'Al día',
    text: `Última ${fmtRelativeTime(last.finishedAt)} en Google Drive, cifrada${mb}`,
  };
});

const JOB_FILTERS = [
  { value: 'all', label: 'Todos', params: {} },
  { value: 'fetch', label: 'Descargas', params: { name: 'fetch' } },
  { value: 'sync', label: 'Sincronizar', params: { name: 'sync' } },
  { value: 'normalize', label: 'Normalizar', params: { name: 'normalize' } },
  { value: 'failed', label: 'Fallidos', params: { failed: true } },
];

const PROVIDERS = {
  'google-health': 'Google',
  digitaltwin: 'Bot',
  xiaomi: 'Báscula (experimental)',
  'intervals-icu': 'intervals.icu',
  telegram: 'Telegram',
};
const INBOX_STATUS = {
  routed: { tone: 'good', label: 'Procesado' },
  received: { tone: 'neutral', label: 'Recibido' },
  ignored: { tone: 'warning', label: 'Ignorado' },
  error: { tone: 'critical', label: 'Error' },
};
const JOB_STATE = {
  completed: { tone: 'good', label: 'Hecho' },
  failed: { tone: 'critical', label: 'Fallido' },
  active: { tone: 'neutral', label: 'En marcha' },
  created: { tone: 'neutral', label: 'Pendiente' },
  retry: { tone: 'warning', label: 'Reintentando' },
  cancelled: { tone: 'neutral', label: 'Cancelado' },
};

const timeFormat = new Intl.DateTimeFormat('es-ES', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const dayFormat = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit' });
const fmtTime = (iso) => (iso ? timeFormat.format(new Date(iso)) : '—');

/** Qué hizo el trabajo, en una línea: proveedor · tipo · días. */
function jobWhat(job) {
  const days =
    job.from && job.to
      ? `${dayFormat.format(new Date(job.from))}→${dayFormat.format(new Date(job.to))}`
      : null;
  return [PROVIDERS[job.provider] ?? job.provider, job.kind, days, job.reason]
    .filter(Boolean)
    .join(' · ');
}

/** El resumen que devolvió el handler ({ changed: 2, points: 30 } → "changed 2 · points 30"). */
function jobResult(job) {
  if (job.error) return job.error;
  if (!job.result || typeof job.result !== 'object') return '';
  return Object.entries(job.result)
    .filter(([, v]) => v == null || typeof v !== 'object')
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ');
}

const fmtMs = (ms) => (ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

const pill = (ok) =>
  ok ? { tone: 'good', label: 'Funcionando' } : { tone: 'critical', label: 'Sin respuesta' };
</script>

<template>
  <div class="admin">
    <AdminHeader
      title="Sistema"
      description="Estado de las piezas de TwinMe. Esto sí es real: lo pregunta a la API."
    />

    <div class="toolbar">
      <span class="muted">{{
        checkedAt ? `Comprobado ${fmtRelativeTime(checkedAt)}` : 'Comprobando…'
      }}</span>
      <button class="btn btn-sm" :disabled="loading" @click="check">
        <RefreshCw class="icon icon-sm" />
        Comprobar
      </button>
    </div>

    <ul class="list card">
      <li class="row">
        <Server class="icon" />
        <div class="info">
          <strong>API</strong>
          <p class="secondary">
            <template v-if="status"
              >Versión {{ status.version }} · en marcha desde hace
              {{ fmtDuration(status.uptime / 60) }}</template
            >
            <template v-else-if="error?.status === 503"
              >Responde, pero alguna dependencia falla</template
            >
            <template v-else>No responde ({{ error?.message ?? '…' }})</template>
          </p>
        </div>
        <StatusPill v-bind="status || error?.status === 503 ? pill(true) : pill(false)" />
      </li>
      <li class="row">
        <Database class="icon" />
        <div class="info">
          <strong>Base de datos</strong>
          <p class="secondary">PostgreSQL + TimescaleDB</p>
        </div>
        <StatusPill v-if="status?.checks?.db" v-bind="pill(status.checks.db === 'ok')" />
        <StatusPill v-else-if="error?.status === 503" tone="critical" label="Sin respuesta" />
        <StatusPill v-else tone="neutral" label="Sin datos" />
      </li>
      <li class="row">
        <Bot class="icon" />
        <div class="info">
          <strong>Bot de Telegram</strong>
          <p class="secondary">{{ bot.text }}</p>
        </div>
        <StatusPill :tone="bot.tone" :label="bot.label" />
      </li>
      <li class="row">
        <Cog class="icon" />
        <div class="info">
          <strong>Worker</strong>
          <p class="secondary">{{ worker.text }}</p>
          <p v-if="worker.lastError" class="error">
            Último error ({{ worker.lastError.job
            }}<template v-if="worker.lastError.provider">
              · {{ worker.lastError.provider }}</template
            >, {{ fmtRelativeTime(worker.lastError.at) }}): {{ worker.lastError.message }}
          </p>
        </div>
        <StatusPill :tone="worker.tone" :label="worker.label" />
      </li>
      <li class="row">
        <HardDriveDownload class="icon" />
        <div class="info">
          <strong>Copias de seguridad</strong>
          <p class="secondary">{{ backup.text }}</p>
        </div>
        <StatusPill :tone="backup.tone" :label="backup.label" />
      </li>
      <li class="row">
        <BrainCircuit class="icon" />
        <div class="info">
          <strong>IA</strong>
          <p class="secondary">
            {{ llm.text }} · <RouterLink to="/admin/ai" class="link">ver gasto</RouterLink>
          </p>
        </div>
        <StatusPill :tone="llm.tone" :label="llm.label" />
      </li>
    </ul>

    <template v-if="queues">
      <h2 class="sub">Cola de trabajos</h2>
      <p class="secondary sub-desc">
        Lo que tiene pendiente el worker. Los números pueden ir hasta un minuto por detrás.
      </p>
      <div class="card table-wrap">
        <table class="queues">
          <thead>
            <tr>
              <th>Cola</th>
              <th class="num">Pendientes</th>
              <th class="num">Aplazados</th>
              <th class="num">En marcha</th>
              <th class="num">Fallidos</th>
              <th class="num">Hechos 24 h</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="q in queues" :key="q.id">
              <td>
                <strong>{{ q.name }}</strong>
                <span class="muted desc">{{ q.description }}</span>
              </td>
              <td class="num">{{ fmtInt(q.ready) }}</td>
              <td class="num">{{ fmtInt(q.deferred) }}</td>
              <td class="num">{{ fmtInt(q.active) }}</td>
              <td class="num" :class="{ bad: q.failed }">{{ fmtInt(q.failed) }}</td>
              <td class="num">{{ fmtInt(q.done) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-if="activity">
      <h2 class="sub">Entradas</h2>
      <p class="secondary sub-desc">
        Lo último que ha llegado de fuera: avisos de Google y eventos del bot.
      </p>
      <div class="card table-wrap">
        <table class="queues">
          <thead>
            <tr>
              <th>Hora</th>
              <th>Origen</th>
              <th>Qué</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in activity.inbox" :key="item.id">
              <td class="when">{{ fmtTime(item.receivedAt) }}</td>
              <td>{{ PROVIDERS[item.provider] ?? item.provider }}</td>
              <td>
                {{ item.type }}
                <span v-if="item.error" class="desc bad-text">{{ item.error }}</span>
              </td>
              <td><StatusPill v-bind="INBOX_STATUS[item.status] ?? INBOX_STATUS.received" /></td>
            </tr>
            <tr v-if="!activity.inbox.length">
              <td colspan="4" class="muted">No ha llegado nada todavía.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 class="sub">Últimos trabajos</h2>
      <p class="secondary sub-desc">
        Lo que ha hecho el worker, incluidas las llamadas a Google, intervals.icu y las
        experimentales. Se guardan 7 días.
      </p>
      <div class="filters">
        <Segmented v-model="jobFilter" :options="JOB_FILTERS" label="Trabajos" />
      </div>
      <div class="card table-wrap">
        <table class="queues">
          <thead>
            <tr>
              <th>Hora</th>
              <th>Cola</th>
              <th>Qué</th>
              <th class="num">Tiempo</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="job in activity.jobs" :key="job.id">
              <td class="when">{{ fmtTime(job.createdAt) }}</td>
              <td>{{ QUEUE_NAMES[job.name] ?? job.name }}</td>
              <td>{{ jobWhat(job) || '—' }}</td>
              <td class="num">{{ fmtMs(job.ms) }}</td>
              <td class="result">
                <StatusPill v-bind="JOB_STATE[job.state] ?? JOB_STATE.created" />
                <span :class="job.error ? 'bad-text' : 'muted'">{{ jobResult(job) }}</span>
                <span v-if="job.retryCount" class="muted"> · {{ job.retryCount }} reintentos</span>
              </td>
            </tr>
            <tr v-if="!activity.jobs.length">
              <td colspan="5" class="muted">Nada por aquí.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.admin {
  max-width: 920px;
  margin: 0 auto;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-size: 12px;
}

.list {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: hidden;
}

.row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 14px;
  align-items: center;
  padding: 16px 20px;
}

.row + .row {
  border-top: 1px solid var(--border);
}

.row > .icon {
  color: var(--text-2);
}

.info p {
  font-size: 13px;
}

.info .error {
  margin-top: 4px;
  color: var(--critical-text);
  font-size: 12px;
}

.sub {
  margin: 32px 0 4px;
  font-size: 15px;
}

.sub-desc {
  margin-bottom: 12px;
  font-size: 13px;
}

.table-wrap {
  overflow-x: auto;
}

.queues {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.queues th,
.queues td {
  padding: 10px 16px;
  text-align: left;
  white-space: nowrap;
}

.queues th {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-2);
}

.queues tbody tr {
  border-top: 1px solid var(--border);
}

.queues .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.queues .desc {
  display: block;
  font-size: 12px;
}

.queues .bad {
  color: var(--critical-text);
  font-weight: 600;
}
.link {
  text-decoration: underline;
}

.filters {
  margin-bottom: 12px;
  overflow-x: auto;
}

.queues .when {
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
}

.queues .result {
  display: flex;
  gap: 8px;
  align-items: center;
}

.bad-text {
  color: var(--critical-text);
}
</style>
