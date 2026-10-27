<script setup>
import { RefreshCw, Unplug, Link2 } from '@lucide/vue';
import StatusPill from '../ui/StatusPill.vue';
import { CONNECTION_STATUS } from '../../data/platforms.js';
import { fmtInt, fmtDec, fmtRelativeTime } from '../../lib/format.js';

/**
 * Estado de una conexión directa (Google, intervals.icu, Xiaomi…) con sus botones. La vista hace
 * las acciones: aquí solo se avisa con sync, connect y disconnect.
 */
const props = defineProps({
  row: { type: Object, required: true }, // { id, name, connection }
  syncing: { type: Boolean, default: false },
});
defineEmits(['sync', 'connect', 'disconnect']);

const monthYear = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' });
const fmtMonthYear = (iso) => monthYear.format(new Date(iso));

/** "usuario · Báscula · conectado hace 2 minutos" */
function details() {
  const { connection } = props.row;
  const devices = connection.details?.devices ?? [];
  return [
    connection.account,
    devices.length ? devices.map((d) => d.name).join(', ') : null,
    connection.connectedAt ? `conectado ${fmtRelativeTime(connection.connectedAt)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "Importando histórico… 12 de 48" mientras dura la carga inicial. */
function backfill() {
  const b = props.row.connection.backfill;
  if (!b || b.status !== 'running') return null;
  return b.total
    ? `Importando histórico… ${fmtInt(b.done + b.failed)} de ${fmtInt(b.total)}`
    : 'Importando histórico…';
}

/** "Último pesaje 76,8 kg · 14,5 % grasa · hace 2 días" */
function lastRecord() {
  const r = props.row.connection.lastRecord;
  if (!r) return null;
  const parts = [
    r.weight != null && `${fmtDec(r.weight)} kg`,
    r.bodyFat != null && `${fmtDec(r.bodyFat)} % grasa`,
  ];
  return `Último pesaje ${parts.filter(Boolean).join(' · ')} · ${fmtRelativeTime(r.at)}`;
}
</script>

<template>
  <div class="panel">
    <div class="head">
      <StatusPill
        :tone="CONNECTION_STATUS[row.connection.status].tone"
        :label="CONNECTION_STATUS[row.connection.status].label"
      />
      <div class="actions">
        <template v-if="row.connection.status === 'connected'">
          <button class="btn btn-sm" :disabled="syncing" @click="$emit('sync')">
            <RefreshCw class="icon icon-sm" :class="{ spin: syncing }" />
            {{ syncing ? 'Sincronizando…' : 'Sincronizar' }}
          </button>
          <button class="btn btn-sm btn-ghost" @click="$emit('disconnect')">
            <Unplug class="icon icon-sm" />
            Desconectar
          </button>
        </template>
        <button
          v-else-if="row.connection.available"
          class="btn btn-sm btn-primary"
          @click="$emit('connect')"
        >
          <Link2 class="icon icon-sm" />
          {{ row.connection.status === 'expired' ? 'Reconectar' : 'Conectar' }}
        </button>
        <button v-else class="btn btn-sm" disabled title="La API aún no conecta este servicio">
          Próximamente
        </button>
      </div>
    </div>
    <p v-if="row.connection.error" class="error">{{ row.connection.error }}</p>
    <p v-if="row.connection.status === 'connected'" class="meta muted">{{ details() }}</p>
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
    <p v-if="backfill()" class="meta hint">{{ backfill() }}</p>
    <p v-if="lastRecord()" class="meta muted">{{ lastRecord() }}</p>
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
</template>

<style scoped>
.panel {
  display: grid;
  gap: 6px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 4px;
}

.actions {
  display: flex;
  gap: 6px;
}

.meta {
  font-size: 12px;
}

.hint {
  font-size: 12px;
  color: var(--text-2);
}

.error {
  font-size: 13px;
  color: var(--warning-text);
}

.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
