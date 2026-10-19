<script setup>
import { computed, onMounted, ref } from 'vue';
import { RefreshCw, Server, Database, Bot, Cog, BrainCircuit } from '@lucide/vue';
import AdminHeader from '../../components/admin/AdminHeader.vue';
import StatusPill from '../../components/ui/StatusPill.vue';
import { fetchSystemStatus } from '../../services/twin.js';
import { fmtDuration, fmtInt, fmtRelativeTime } from '../../lib/format.js';
import { balanceStatus, fetchAiStatus } from '../../services/ai.js';

const status = ref(null);
const error = ref(null);
const loading = ref(false);
const checkedAt = ref(null);
const ai = ref(null);

async function check() {
  loading.value = true;
  fetchAiStatus()
    .then((value) => (ai.value = value))
    .catch(() => (ai.value = null));
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
];
const queues = computed(() => {
  const stats = report.value?.queues;
  if (!stats) return null;
  const jobs = report.value?.services?.worker?.stats?.jobs ?? {};
  return QUEUES.map(([id, name, description]) => ({
    id,
    name,
    description,
    ...(stats[id] ?? { ready: 0, deferred: 0, active: 0, failed: 0 }),
    done: jobs[id]?.done ?? 0,
  }));
});

const llm = computed(() => balanceStatus(ai.value));

const pill = (ok) =>
  ok ? { tone: 'good', label: 'Funcionando' } : { tone: 'critical', label: 'Sin respuesta' };
</script>

<template>
  <div class="admin">
    <AdminHeader
      title="Sistema"
      description="Estado de las piezas de Digital Twin. Esto sí es real: lo pregunta a la API."
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
              <th class="num" title="Desde que arrancó el worker">Hechos</th>
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
</style>
