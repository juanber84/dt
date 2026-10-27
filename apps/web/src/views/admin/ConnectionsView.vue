<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Unplug, Info, Search, Send } from '@lucide/vue';
import AdminHeader from '../../components/admin/AdminHeader.vue';
import ConnectionPanel from '../../components/connections/ConnectionPanel.vue';
import PlatformCard from '../../components/connections/PlatformCard.vue';
import PlatformDetail from '../../components/connections/PlatformDetail.vue';
import PlatformLogo from '../../components/connections/PlatformLogo.vue';
import XiaomiConnectModal from '../../components/admin/XiaomiConnectModal.vue';
import IntervalsConnectModal from '../../components/admin/IntervalsConnectModal.vue';
import MotraConnectModal from '../../components/admin/MotraConnectModal.vue';
import StatusPill from '../../components/ui/StatusPill.vue';
import { useAsync } from '../../composables/useAsync.js';
import { useConfirm } from '../../composables/useConfirm.js';
import { useToast } from '../../composables/useToast.js';
import { SOURCES, DATA_TYPES } from '../../data/sources.js';
import {
  CATEGORIES,
  CONNECTION_STATUS,
  PLATFORMS,
  matchesPlatform,
  platformById,
} from '../../data/platforms.js';
import {
  fetchConnections,
  connectProvider,
  syncProvider,
  disconnectProvider,
  linkTelegram,
  unlinkTelegram,
} from '../../services/twin.js';
import { fmtInt, fmtRelativeTime } from '../../lib/format.js';

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

/** La conexión de una plataforma que se conecta aquí, con lo que esperan el panel y las acciones. */
function rowOf(platform) {
  if (!platform?.source) return null;
  const connection = connections.value?.find((c) => c.id === platform.source);
  return {
    id: platform.source,
    name: platform.name,
    auth: SOURCES[platform.source]?.auth,
    connection: connection ?? { status: 'disconnected' },
  };
}

// Las experimentales (Xiaomi, Motra) solo si la API las da: no salen si no las tienes activadas
const platforms = computed(() =>
  PLATFORMS.filter(
    (p) => p.state !== 'experimental' || connections.value?.some((c) => c.id === p.source),
  ),
);
// Las que se pueden conectar ya (o lo están): las de "Próximamente" no cuentan
const rows = computed(() =>
  platforms.value
    .map(rowOf)
    .filter((r) => r && (r.connection.available || r.connection.status !== 'disconnected')),
);
const connectedCount = computed(
  () => rows.value.filter((r) => r.connection.status === 'connected').length,
);
const attention = computed(
  () => rows.value.filter((r) => ['expired', 'error'].includes(r.connection.status)).length,
);

/** La pastilla de una plataforma con conexión (o Telegram vinculado); null si no hay. */
function pillOf(platform) {
  if (platform.id === 'telegram') {
    return telegram.value.status === 'connected' ? { tone: 'good', label: 'Vinculado' } : null;
  }
  const status = rowOf(platform)?.connection.status;
  return status && status !== 'disconnected' ? CONNECTION_STATUS[status] : null;
}
const mine = computed(() => platforms.value.filter(pillOf));
const lastSyncOf = (p) => {
  const at = rowOf(p)?.connection.lastSync;
  return at ? `sincronizado ${fmtRelativeTime(at)}` : '';
};

// Catálogo: buscador y categoría
const query = ref('');
const category = ref('all');
const categoryOptions = [
  ['all', 'Todas'],
  ...Object.entries(CATEGORIES).map(([id, c]) => [id, c.label]),
];
const groups = computed(() =>
  Object.entries(CATEGORIES)
    .filter(([id]) => category.value === 'all' || category.value === id)
    .map(([id, c]) => ({
      id,
      ...c,
      items: platforms.value.filter(
        (p) => p.category === id && matchesPlatform(p, query.value, DATA_TYPES),
      ),
    }))
    .filter((g) => g.items.length),
);
const viaName = (p) => (p.via ?? []).map((id) => platformById(id)?.name).join(' o ');

// Ficha: /admin/connections/:platform
const platform = computed(() => {
  const id = route.params.platform;
  return id ? platforms.value.find((p) => p.id === id) : null;
});
const platformRow = computed(() => rowOf(platform.value));
watch(
  () => [route.params.platform, connections.value],
  ([id]) => {
    // Una que no existe (o experimental sin permiso, ya cargadas) vuelve al catálogo
    if (id && !platformById(id)) router.replace('/admin/connections');
    else if (id && connections.value && !platform.value) router.replace('/admin/connections');
  },
  { immediate: true },
);

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
  toast.show(
    `Fuerza (experimental) conectado (${connection.account}): trayendo el histórico`,
    'good',
  );
}

function onXiaomiConnected(connection) {
  xiaomiOpen.value = false;
  reload.value++;
  toast.show(
    connection.details?.devices?.length === 0
      ? 'Báscula (experimental) conectada, pero no hay básculas en ese servidor: revisa la región'
      : 'Báscula (experimental) conectada',
    'good',
  );
}
</script>

<template>
  <div class="admin">
    <PlatformDetail
      v-if="platform"
      :platform="platform"
      :connectable="Boolean(platformRow) || platform.id === 'telegram'"
      :pill-for="pillOf"
    >
      <ConnectionPanel
        v-if="platformRow"
        :row="platformRow"
        :syncing="syncing === platformRow.id"
        @sync="sync(platformRow)"
        @connect="connect(platformRow)"
        @disconnect="disconnect(platformRow)"
      />
      <div v-else-if="platform.id === 'telegram'" class="telegram">
        <p v-if="telegram.status === 'connected'" class="secondary">
          {{ telegram.account }} · vinculado {{ fmtRelativeTime(telegram.connectedAt) }}
        </p>
        <p v-else-if="linking" class="secondary">
          <template v-if="linking.url"
            >Se ha abierto el bot: pulsa <b>Iniciar</b>. Si no se abre,
            <a :href="linking.url" target="_blank" rel="noopener">ábrelo aquí</a> o </template
          >escríbele <code>{{ linking.command }}</code
          >. Esperando confirmación…
        </p>
        <p v-else class="secondary">
          Vincula tu cuenta de Telegram para que lo que le mandes al bot se guarde a tu nombre.
        </p>
        <div>
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
        </div>
      </div>
    </PlatformDetail>

    <template v-else>
      <AdminHeader
        title="Conexiones"
        description="Las plataformas de las que TwinMe lee tus datos: unas se conectan aquí y otras llegan a través de ellas. Los tokens se quedan en la API, nunca en el navegador."
      />

      <p v-if="result?.persistent === false" class="notice">
        <Info class="icon icon-sm" />
        La API no tiene clave de cifrado (TOKEN_ENCRYPTION_KEY): las conexiones se guardan en
        memoria y hay que volver a conectar cada vez que se reinicia.
      </p>

      <div v-if="error" class="load-error card">
        <span>No se han podido cargar las conexiones: {{ error.message }}</span>
        <button class="btn btn-sm" @click="reload++">Reintentar</button>
      </div>

      <section v-if="mine.length" class="group">
        <div class="summary">
          <h2 class="sub">Tus conexiones</h2>
          <span class="muted"
            ><strong>{{ connectedCount }}</strong> de {{ rows.length }} conectadas</span
          >
          <StatusPill v-if="attention" tone="warning" :label="`${attention} necesita atención`" />
        </div>
        <ul class="mine card">
          <li v-for="p in mine" :key="p.id">
            <RouterLink :to="`/admin/connections/${p.id}`" class="mine-row">
              <PlatformLogo :platform="p" :size="32" />
              <strong>{{ p.name }}</strong>
              <span class="muted when">{{ lastSyncOf(p) }}</span>
              <StatusPill :tone="pillOf(p).tone" :label="pillOf(p).label" />
            </RouterLink>
          </li>
        </ul>
      </section>
      <p v-else-if="loading && !connections" class="muted">Cargando…</p>

      <div class="filters">
        <label class="search">
          <Search class="icon icon-sm muted" />
          <input
            v-model="query"
            class="input"
            type="search"
            placeholder="Buscar: Garmin, sueño, báscula…"
            aria-label="Buscar plataformas"
          />
        </label>
        <div class="cats" role="radiogroup" aria-label="Categoría">
          <button
            v-for="[id, label] in categoryOptions"
            :key="id"
            role="radio"
            :aria-checked="category === id"
            :class="{ active: category === id }"
            @click="category = id"
          >
            {{ label }}
          </button>
        </div>
      </div>

      <section v-for="g in groups" :key="g.id" class="group">
        <h2 class="sub">{{ g.label }}</h2>
        <div class="grid">
          <PlatformCard
            v-for="p in g.items"
            :key="p.id"
            :platform="p"
            :pill="pillOf(p)"
            :via-name="viaName(p)"
          />
        </div>
      </section>
      <p v-if="!groups.length" class="muted empty">Nada con «{{ query }}».</p>
    </template>

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
.admin {
  max-width: 920px;
  margin: 0 auto;
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

.group {
  display: grid;
  gap: 10px;
  margin-bottom: 28px;
}

.sub {
  margin: 0;
  font-size: 15px;
}

.summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 13px;
}

.mine {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: hidden;
}

.mine li + li {
  border-top: 1px solid var(--border);
}

.mine-row {
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  color: inherit;
  text-decoration: none;
}

.mine-row:hover {
  background: var(--surface-hover);
}

.when {
  font-size: 12px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filters {
  display: grid;
  gap: 12px;
  margin-bottom: 20px;
}

.search {
  position: relative;
  display: block;
}

.search .icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
}

.search .input {
  width: 100%;
  padding-left: 34px;
}

.cats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.cats button {
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: none;
  color: var(--text-2);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.cats button.active {
  background: var(--text);
  border-color: var(--text);
  color: var(--inverse);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}

.telegram {
  display: grid;
  gap: 10px;
  font-size: 13px;
}

.empty {
  font-size: 13px;
}

@media (max-width: 600px) {
  .mine-row {
    grid-template-columns: auto 1fr auto;
  }

  .when {
    display: none;
  }
}
</style>
