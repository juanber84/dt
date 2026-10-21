<script setup>
import { computed, onMounted, ref } from 'vue';
import { Bell, BellOff, Send, Smartphone, Trash2 } from '@lucide/vue';
import { useConfirm } from '../../composables/useConfirm.js';
import { useToast } from '../../composables/useToast.js';
import {
  currentEndpoint,
  disablePush,
  enablePush,
  fetchPush,
  pushState,
  removeDevice,
  savePushSettings,
  sendTestPush,
} from '../../services/push.js';
import { fmtRelativeTime } from '../../lib/format.js';

const toast = useToast();
const { ask } = useConfirm();
const info = ref(null); // lo que dice la API (null: aún no / sin push en el servidor)
const state = ref('checking');
const here = ref(null);
const busy = ref(false);

async function load() {
  try {
    info.value = await fetchPush();
  } catch {
    info.value = null; // 404: la API no tiene claves VAPID
  }
  state.value = await pushState().catch(() => 'unsupported');
  here.value = await currentEndpoint().catch(() => null);
  // El dispositivo está suscrito pero la API no lo tiene con este usuario (otra cuenta en el mismo
  // móvil, o se borró): se vuelve a apuntar, sin preguntar (el permiso ya está dado)
  if (
    info.value &&
    state.value === 'on' &&
    !info.value.devices.some((d) => d.endpoint === here.value)
  ) {
    await enablePush(info.value.publicKey).catch(() => {});
    info.value = await fetchPush().catch(() => info.value);
  }
}
onMounted(load);

const disabled = computed(() => new Set(info.value?.settings.disabled ?? []));

async function enable() {
  busy.value = true;
  try {
    const result = await enablePush(info.value.publicKey);
    if (result === 'granted') toast.show('Avisos activados en este dispositivo');
    else if (result === 'denied') toast.show('Has bloqueado los avisos', 'critical');
  } catch (err) {
    toast.show(err.status ? err.message : 'No se han podido activar los avisos', 'critical');
  } finally {
    busy.value = false;
    await load();
  }
}

async function disable() {
  busy.value = true;
  try {
    await disablePush();
  } finally {
    busy.value = false;
    await load();
  }
}

async function remove(device) {
  if (device.endpoint === here.value) return disable();
  const ok = await ask({
    title: `¿Quitar ${device.device ?? 'este dispositivo'}?`,
    message: 'Dejarán de llegarle los avisos. Puedes volver a activarlos desde él.',
    confirmLabel: 'Quitar',
    danger: true,
  });
  if (!ok) return;
  await removeDevice(device.endpoint).catch(() => {});
  await load();
}

async function test() {
  busy.value = true;
  try {
    const { status, delivered } = await sendTestPush();
    if (status === 'sent' && delivered) toast.show('Enviado: te llegará en unos segundos');
    else toast.show('No hay ningún dispositivo que lo pueda recibir', 'critical');
  } catch (err) {
    toast.show(err.message, 'critical');
  } finally {
    busy.value = false;
  }
}

async function save(patch) {
  try {
    info.value.settings = await savePushSettings(patch);
  } catch (err) {
    toast.show(`No se ha guardado (${err.message})`, 'critical');
  }
}

function toggle(kind, on) {
  const set = new Set(disabled.value);
  if (on) set.delete(kind);
  else set.add(kind);
  save({ disabled: [...set] });
}

const HINTS = {
  install:
    'En el iPhone, los avisos solo llegan a la app instalada: en Safari, Compartir → Añadir a pantalla de inicio, y ábrela desde el icono.',
  unsupported: 'Este navegador no admite avisos.',
  denied:
    'Los has bloqueado. Para activarlos: Ajustes del iPhone → Notificaciones → Twin (o los permisos del navegador).',
};
</script>

<template>
  <section class="notifications">
    <h2 class="sub">Notificaciones</h2>
    <p class="secondary sub-desc">
      Avisos cuando pasa algo que te interesa. Solo llegan a los dispositivos donde los actives (por
      ejemplo, solo el iPhone). Tú eliges cuáles y cuándo no molestar.
    </p>

    <p v-if="!info && state !== 'checking'" class="muted">
      El servidor aún no tiene los avisos configurados.
    </p>

    <template v-else-if="info">
      <div class="card status">
        <component :is="state === 'on' ? Bell : BellOff" class="icon" />
        <div class="text">
          <strong>{{
            state === 'on' ? 'Activados en este dispositivo' : 'Desactivados en este dispositivo'
          }}</strong>
          <span v-if="HINTS[state]" class="muted">{{ HINTS[state] }}</span>
        </div>
        <div class="actions">
          <button v-if="state === 'off'" class="btn btn-primary" :disabled="busy" @click="enable">
            Activar
          </button>
          <template v-else-if="state === 'on'">
            <button class="btn" :disabled="busy" @click="test">
              <Send class="icon icon-sm" /> Probar
            </button>
            <button class="btn btn-ghost" :disabled="busy" @click="disable">Desactivar</button>
          </template>
        </div>
      </div>

      <h3 class="sub-sm">Qué avisos</h3>
      <ul class="card kinds">
        <li v-for="k in info.kinds" :key="k.id">
          <label class="kind">
            <span class="text">
              <strong>{{ k.label }}</strong>
              <span class="muted">{{ k.description }}</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              class="switch"
              :checked="!disabled.has(k.id)"
              @change="toggle(k.id, $event.target.checked)"
            />
          </label>
        </li>
      </ul>

      <h3 class="sub-sm">No molestar</h3>
      <div class="card quiet">
        <label>
          <span class="muted">De</span>
          <input
            class="input"
            type="time"
            :value="info.settings.quietFrom"
            @change="save({ quietFrom: $event.target.value })"
          />
        </label>
        <label>
          <span class="muted">a</span>
          <input
            class="input"
            type="time"
            :value="info.settings.quietTo"
            @change="save({ quietTo: $event.target.value })"
          />
        </label>
        <p class="muted note">
          Lo que llegue en esas horas te lo mandamos al acabar. Como mucho
          {{ info.settings.maxPerDay }} avisos al día.
        </p>
      </div>

      <template v-if="info.devices.length">
        <h3 class="sub-sm">Dispositivos</h3>
        <ul class="card devices">
          <li v-for="d in info.devices" :key="d.id">
            <Smartphone class="icon icon-sm" />
            <span class="text">
              <strong>{{ d.device ?? 'Dispositivo' }}</strong>
              <span v-if="d.endpoint === here" class="pill">este</span>
            </span>
            <span class="muted">{{
              d.lastSentAt ? `último aviso ${fmtRelativeTime(d.lastSentAt)}` : 'sin avisos aún'
            }}</span>
            <button
              class="btn btn-ghost btn-icon btn-sm"
              :aria-label="`Quitar ${d.device ?? 'dispositivo'}`"
              title="Quitar"
              @click="remove(d)"
            >
              <Trash2 class="icon icon-sm" />
            </button>
          </li>
        </ul>
      </template>

      <template v-if="info.history.length">
        <h3 class="sub-sm">Últimos avisos</h3>
        <ul class="card history">
          <li v-for="h in info.history.slice(0, 5)" :key="h.id">
            <span class="text">
              <strong>{{ h.title }}</strong>
              <span class="muted">{{ h.body }}</span>
            </span>
            <span class="muted when">{{ fmtRelativeTime(h.sentAt) }}</span>
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
}

.actions {
  display: flex;
  gap: 6px;
  flex: none;
}

.kinds,
.devices,
.history {
  margin: 0;
  padding: 0;
  list-style: none;
}

.kinds li + li,
.devices li + li,
.history li + li {
  border-top: 1px solid var(--border);
}

.kind {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
}

/* Interruptor a partir de un checkbox (role="switch") */
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

.quiet {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
  padding: 14px 16px;
}

.quiet label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.quiet .input {
  width: auto;
}

.quiet .note {
  flex-basis: 100%;
  font-size: 12px;
}

.devices li,
.history li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  font-size: 12px;
}

.devices .text {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pill {
  padding: 1px 7px;
  border-radius: 10px;
  background: var(--surface-2);
  font-size: 11px;
  color: var(--text-2);
}

.history .when {
  flex: none;
}

@media (max-width: 860px) {
  .status {
    flex-wrap: wrap;
  }

  .actions {
    width: 100%;
  }

  .actions .btn {
    flex: 1;
    justify-content: center;
  }
}
</style>
