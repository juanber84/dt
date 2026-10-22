<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { RefreshCw, Unplug, Link2, Info, Send } from '@lucide/vue';
import AdminHeader from '../../components/admin/AdminHeader.vue';
import XiaomiConnectModal from '../../components/admin/XiaomiConnectModal.vue';
import IntervalsConnectModal from '../../components/admin/IntervalsConnectModal.vue';
import MotraConnectModal from '../../components/admin/MotraConnectModal.vue';
import SourceBadge from '../../components/ui/SourceBadge.vue';
import StatusPill from '../../components/ui/StatusPill.vue';
import { useAsync } from '../../composables/useAsync.js';
import { useConfirm } from '../../composables/useConfirm.js';
import { useToast } from '../../composables/useToast.js';
import { SOURCES, DATA_TYPES } from '../../data/sources.js';
import {
  fetchConnections,
  connectProvider,
  syncProvider,
  disconnectProvider,
  linkTelegram,
  unlinkTelegram,
} from '../../services/twin.js';
import { fmtInt, fmtDec, fmtRelativeTime } from '../../lib/format.js';

const monthYear = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' });
const fmtMonthYear = (iso) => monthYear.format(new Date(iso));

const route = useRoute();
const router = useRouter();
const reload = ref(0);
// Se recarga tras conectar o desconectar
const { data: result, error, loading } = useAsync(reload, fetchConnections);
const connections = computed(() => result.value?.items ?? null);
const toast = useToast();
const { ask } = useConfirm();
const xiaomiOpen = ref(false);
const intervalsOpen = ref(false);
const motraOpen = ref(false);
const syncing = ref(null);

const STATUS = {
  connected: { tone: 'good', label: 'Conectado' },
  expired: { tone: 'warning', label: 'Hay que reconectar' },
  error: { tone: 'critical', label: 'Error' },
  disconnected: { tone: 'neutral', label: 'Sin conectar' },
};

const rows = computed(() =>
  Object.entries(SOURCES)
    .filter(([, s]) => s.auth !== 'internal')
    .map(([id, source]) => ({
      id,
      ...source,
      connection: connections.value?.find((c) => c.id === id) ?? { status: 'disconnected' },
    })),
);
const internal = computed(() => Object.entries(SOURCES).filter(([, s]) => s.auth === 'internal'));
const connectedCount = computed(
  () => rows.value.filter((r) => r.connection.status === 'connected').length,
);
const attention = computed(
  () => rows.value.filter((r) => ['expired', 'error'].includes(r.connection.status)).length,
);

/** "usuario · Báscula · conectado hace 2 minutos" */
function details({ connection }) {
  const devices = connection.details?.devices ?? [];
  return [
    connection.account,
    devices.length ? devices.map((d) => d.name).join(', ') : null,
    connection.connectedAt ? `conectado ${fmtRelativeTime(connection.connectedAt)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

async function run(action, label) {
  try {
    await action();
  } catch (err) {
    toast.show(
      err.code === 'NOT_IMPLEMENTED'
        ? `${label}: pendiente de la API (${err.message.replace(/^La API /, 'la API ')})`
        : err.message,
    );
  }
}

async function sync(row) {
  syncing.value = row.id;
  await run(async () => {
    const { queued, added, total } = await syncProvider(row.id);
    if (queued) {
      toast.show(`${row.name}: sincronización en marcha, los datos irán apareciendo`, 'good');
      return;
    }
    toast.show(
      added
        ? `${row.name}: ${fmtInt(added)} ${added === 1 ? 'medición nueva' : 'mediciones nuevas'} (${fmtInt(total)} en total)`
        : `${row.name}: nada nuevo (${fmtInt(total)} en total)`,
      'good',
    );
  }, `Sincronizar ${row.name}`);
  syncing.value = null;
  reload.value++;
}

/** "Importando histórico… 12 de 48" mientras dura la carga inicial. */
function backfill({ connection }) {
  const b = connection.backfill;
  if (!b || b.status !== 'running') return null;
  return b.total
    ? `Importando histórico… ${fmtInt(b.done + b.failed)} de ${fmtInt(b.total)}`
    : 'Importando histórico…';
}

// Telegram: se vincula tu cuenta (no es un proveedor que conectar)
const telegram = computed(() => result.value?.telegram ?? { status: 'disconnected' });
const linking = ref(null);

async function startTelegramLink() {
  await run(async () => {
    linking.value = await linkTelegram();
    if (linking.value.url) window.open(linking.value.url, '_blank', 'noopener');
  }, 'Vincular Telegram');
}

async function unlinkTelegramAccount() {
  const ok = await ask({
    title: 'Desvincular Telegram',
    message: 'Lo que mandes al bot dejará de guardarse a tu nombre.',
    confirmLabel: 'Desvincular',
    danger: true,
  });
  if (!ok) return;
  run(async () => {
    await unlinkTelegram();
    reload.value++;
    toast.show('Telegram desvinculado');
  }, 'Desvincular Telegram');
}

// Se refresca solo mientras haya una carga inicial en marcha (cada 5 s) o se esté esperando a que
// el bot confirme el vínculo (cada 3 s, hasta que caduque el código)
let poll;
watch(result, (value) => {
  clearTimeout(poll);
  if (linking.value && value?.telegram?.status === 'connected') {
    linking.value = null;
    toast.show('Telegram vinculado', 'good');
  }
  if (linking.value && Date.parse(linking.value.expiresAt) <= Date.now()) linking.value = null;
  if (linking.value) poll = setTimeout(() => reload.value++, 3000);
  else if (value?.items?.some((c) => c.backfill?.status === 'running')) {
    poll = setTimeout(() => reload.value++, 5000);
  }
});
watch(linking, (value) => {
  if (value) {
    clearTimeout(poll);
    poll = setTimeout(() => reload.value++, 3000);
  }
});
onUnmounted(() => clearTimeout(poll));

/** "Último pesaje 76,8 kg · 14,5 % grasa · hace 2 días" */
function lastRecord({ connection }) {
  const r = connection.lastRecord;
  if (!r) return null;
  const parts = [
    r.weight != null && `${fmtDec(r.weight)} kg`,
    r.bodyFat != null && `${fmtDec(r.bodyFat)} % grasa`,
  ];
  return `Último pesaje ${parts.filter(Boolean).join(' · ')} · ${fmtRelativeTime(r.at)}`;
}

// Vuelta del OAuth: ?provider=google-health&result=connected|error&reason=...
const OAUTH_ERRORS = {
  denied: 'no has dado permiso',
  expired: 'el intento ha caducado, vuelve a probar',
  exchange: 'Google no ha aceptado la autorización, vuelve a probar',
};
onMounted(() => {
  const { provider, result, reason } = route.query;
  if (!provider || !result) return;
  const name = SOURCES[provider]?.name ?? provider;
  if (result === 'connected') toast.show(`${name} conectado`, 'good');
  else toast.show(`No se ha conectado ${name}: ${OAUTH_ERRORS[reason] ?? reason}`);
  router.replace({ query: {} });
});

function connect(row) {
  if (row.auth === 'credentials') return (xiaomiOpen.value = true);
  if (row.auth === 'apikey') return (intervalsOpen.value = true);
  if (row.auth === 'login') return (motraOpen.value = true);
  run(() => connectProvider(row.id), `Conectar ${row.name}`);
}

async function disconnect(row) {
  const ok = await ask({
    title: `Desconectar ${row.name}`,
    message: 'Para volver a conectarlo tendrás que iniciar sesión otra vez.',
    confirmLabel: 'Desconectar',
    danger: true,
  });
  if (!ok) return;
  run(async () => {
    await disconnectProvider(row.id);
    reload.value++;
    toast.show(`${row.name} desconectado`);
  }, `Desconectar ${row.name}`);
}

function onIntervalsConnected(connection) {
  intervalsOpen.value = false;
  reload.value++;
  toast.show(`intervals.icu conectado (${connection.account}): trayendo el histórico`, 'good');
}

function onMotraConnected(connection) {
  motraOpen.value = false;
  reload.value++;
  toast.show(`Motra conectado (${connection.account}): trayendo el histórico`, 'good');
}

function onXiaomiConnected(connection) {
  xiaomiOpen.value = false;
  reload.value++;
  toast.show(
    connection.details?.devices?.length === 0
      ? 'Xiaomi conectado, pero no hay básculas en ese servidor: revisa la región'
      : 'Xiaomi conectado',
    'good',
  );
}
</script>

<template>
  <div class="admin">
    <AdminHeader
      title="Conexiones"
      description="Da permiso a Digital Twin para leer tus datos de cada servicio. Los tokens se quedan en la API, nunca en el navegador."
    />

    <p v-if="result?.persistent === false" class="notice">
      <Info class="icon icon-sm" />
      La API no tiene clave de cifrado (TOKEN_ENCRYPTION_KEY): las conexiones se guardan en memoria
      y hay que volver a conectar cada vez que se reinicia.
    </p>

    <div v-if="error" class="load-error card">
      <span>No se han podido cargar las conexiones: {{ error.message }}</span>
      <button class="btn btn-sm" @click="reload++">Reintentar</button>
    </div>

    <div class="summary">
      <span v-if="loading && !connections" class="muted">Cargando…</span>
      <span v-else
        ><strong>{{ connectedCount }}</strong> de {{ rows.length }} conectadas</span
      >
      <StatusPill v-if="attention" tone="warning" :label="`${attention} necesita atención`" />
    </div>

    <ul class="list card">
      <li v-for="row in rows" :key="row.id" class="row">
        <SourceBadge :source="row.id" :size="40" />
        <div class="info">
          <div class="name">
            <strong>{{ row.name }}</strong>
            <StatusPill
              :tone="STATUS[row.connection.status].tone"
              :label="STATUS[row.connection.status].label"
            />
          </div>
          <p class="secondary">{{ row.description }}</p>
          <div class="types">
            <span v-for="t in row.provides" :key="t" class="chip">{{ DATA_TYPES[t] }}</span>
          </div>
          <p v-if="row.connection.error" class="error">{{ row.connection.error }}</p>
          <p v-if="row.connection.status === 'connected'" class="meta muted">
            {{ details(row) }}
          </p>
          <p v-if="row.connection.lastSync" class="meta muted">
            Última sincronización {{ fmtRelativeTime(row.connection.lastSync) }}
            <span v-if="row.connection.records != null">
              · {{ fmtInt(row.connection.records) }}
              {{ row.connection.records === 1 ? 'registro' : 'registros' }}</span
            >
            <span v-if="row.connection.firstRecordAt">
              desde {{ fmtMonthYear(row.connection.firstRecordAt) }}</span
            >
          </p>
          <p v-if="backfill(row)" class="meta hint">{{ backfill(row) }}</p>
          <p v-if="lastRecord(row)" class="meta muted">{{ lastRecord(row) }}</p>
          <p
            v-else-if="
              row.connection.status === 'connected' &&
              !row.connection.lastSync &&
              !row.connection.backfill
            "
            class="meta hint"
          >
            Pulsa Sincronizar para traer todo el histórico.
          </p>
        </div>
        <div class="actions">
          <template v-if="row.connection.status === 'connected'">
            <button class="btn btn-sm" :disabled="syncing === row.id" @click="sync(row)">
              <RefreshCw class="icon icon-sm" :class="{ spin: syncing === row.id }" />
              {{ syncing === row.id ? 'Sincronizando…' : 'Sincronizar' }}
            </button>
            <button class="btn btn-sm btn-ghost" @click="disconnect(row)">
              <Unplug class="icon icon-sm" />
              Desconectar
            </button>
          </template>
          <button
            v-else-if="row.connection.available"
            class="btn btn-sm btn-primary"
            @click="connect(row)"
          >
            <Link2 class="icon icon-sm" />
            {{ row.connection.status === 'expired' ? 'Reconectar' : 'Conectar' }}
          </button>
          <button v-else class="btn btn-sm" disabled title="La API aún no conecta este servicio">
            Próximamente
          </button>
        </div>
      </li>
    </ul>

    <h2 class="sub">Fuentes internas</h2>
    <p class="secondary sub-desc">No hace falta conectarlas: escriben directamente en la API.</p>
    <ul class="list card">
      <li v-for="[id, source] in internal" :key="id" class="row compact">
        <SourceBadge :source="id" :size="32" />
        <div class="info">
          <div class="name">
            <strong>{{ source.name }}</strong>
            <StatusPill
              v-if="id === 'telegram'"
              :tone="telegram.status === 'connected' ? 'good' : 'warning'"
              :label="telegram.status === 'connected' ? 'Vinculado' : 'Sin vincular'"
            />
          </div>
          <p class="secondary">{{ source.description }}</p>
          <template v-if="id === 'telegram'">
            <p v-if="telegram.status === 'connected'" class="meta muted">
              {{ telegram.account }} · vinculado {{ fmtRelativeTime(telegram.connectedAt) }}
            </p>
            <p v-else-if="linking" class="meta hint">
              <template v-if="linking.url"
                >Se ha abierto el bot: pulsa <b>Iniciar</b>. Si no se abre,
                <a :href="linking.url" target="_blank" rel="noopener">ábrelo aquí</a> o </template
              >escríbele <code>{{ linking.command }}</code
              >. Esperando confirmación…
            </p>
            <p v-else class="meta hint">
              Vincula tu cuenta de Telegram para que lo que le mandes al bot se guarde a tu nombre.
            </p>
          </template>
        </div>
        <template v-if="id === 'telegram'">
          <button
            v-if="telegram.status === 'connected'"
            class="btn btn-sm btn-ghost"
            @click="unlinkTelegramAccount"
          >
            <Unplug class="icon icon-sm" />
            Desvincular
          </button>
          <button
            v-else-if="telegram.available"
            class="btn btn-sm btn-primary"
            :disabled="Boolean(linking)"
            @click="startTelegramLink"
          >
            <Send class="icon icon-sm" />
            {{ linking ? 'Esperando…' : 'Vincular' }}
          </button>
          <button
            v-else
            class="btn btn-sm"
            disabled
            title="La API necesita BD y DIGITALTWIN_WEBHOOK_SECRET"
          >
            No disponible
          </button>
        </template>
        <StatusPill v-else tone="good" label="Activa" />
      </li>
    </ul>

    <XiaomiConnectModal
      :open="xiaomiOpen"
      @close="xiaomiOpen = false"
      @connected="onXiaomiConnected"
    />
    <MotraConnectModal :open="motraOpen" @close="motraOpen = false" @connected="onMotraConnected" />
    <IntervalsConnectModal
      :open="intervalsOpen"
      @close="intervalsOpen = false"
      @connected="onIntervalsConnected"
    />
  </div>
</template>

<style scoped>
.hint {
  font-size: 12px;
  color: var(--text-2);
}

.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.notice {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  font-size: 12px;
  color: var(--muted);
}

.notice .icon {
  flex: none;
  margin-top: 2px;
}

.load-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 16px;
  font-size: 13px;
}

.admin {
  max-width: 920px;
  margin: 0 auto;
}

.summary {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  color: var(--text-2);
}

.list {
  margin: 0 0 32px;
  padding: 0;
  list-style: none;
  overflow: hidden;
}

.row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 16px;
  align-items: start;
  padding: 18px 20px;
}

.row + .row {
  border-top: 1px solid var(--border);
}

.row.compact {
  align-items: center;
  padding: 14px 20px;
}

.info {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.info p {
  font-size: 13px;
}

.name {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.types {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 11px;
}

.meta {
  font-size: 12px !important;
}

.error {
  color: var(--warning-text);
}

.actions {
  display: flex;
  gap: 6px;
}

.sub {
  margin-bottom: 2px;
}

.sub-desc {
  font-size: 13px;
  margin-bottom: 12px;
}

@media (max-width: 700px) {
  .row {
    grid-template-columns: auto 1fr;
  }

  .actions,
  .row > :nth-child(n + 3) {
    grid-column: 2;
    justify-self: start;
  }

  .row,
  .row.compact {
    gap: 12px 14px;
    align-items: start;
    padding: 16px;
  }
}
</style>
