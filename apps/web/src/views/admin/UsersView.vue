<script setup>
import { computed, reactive, ref } from 'vue';
import { ChevronRight, Copy, Plus, UserRound } from '@lucide/vue';
import AdminHeader from '../../components/admin/AdminHeader.vue';
import Modal from '../../components/ui/Modal.vue';
import PasswordInput from '../../components/ui/PasswordInput.vue';
import StatusPill from '../../components/ui/StatusPill.vue';
import { useAsync } from '../../composables/useAsync.js';
import { useAuth } from '../../composables/useAuth.js';
import { useConfirm } from '../../composables/useConfirm.js';
import { useToast } from '../../composables/useToast.js';
import { addDays, formatShortDate, toISODate, todayISO } from '../../lib/dates.js';
import { fmtRelativeTime } from '../../lib/format.js';
import { sourceName } from '../../data/sources.js';
import {
  DEMO_DAYS,
  createUser,
  deleteUser,
  endOfDayISO,
  listUsers,
  updateUser,
} from '../../services/users.js';

/**
 * Usuarios: dar de alta (también cuentas demo para enseñar el producto), activar funciones extra
 * (p. ej. las conexiones experimentales), desactivar y borrar.
 */
const { user: me } = useAuth();
const toast = useToast();
const { ask } = useConfirm();
const reload = ref(0);
const { data, error, loading } = useAsync(reload, listUsers);
const users = computed(() => data.value?.items ?? []);
const features = computed(() => data.value?.features ?? []);
const featureLabel = (id) => features.value.find((f) => f.id === id)?.label ?? id;

function status(u) {
  if (u.disabledAt) return { tone: 'neutral', label: 'Desactivado' };
  if (!u.active) return { tone: 'warning', label: 'Caducado' };
  if (u.expiresAt)
    return { tone: 'good', label: `Hasta el ${formatShortDate(toISODate(new Date(u.expiresAt)))}` };
  return { tone: 'good', label: 'Activo' };
}

/** "Admin · Demo · Xiaomi, Google · entró hace 2 horas" */
const detail = (u) =>
  [
    u.role === 'admin' ? 'Admin' : null,
    u.demo ? 'Demo' : null,
    ...u.features.map(featureLabel),
    u.connections.length ? u.connections.map(sourceName).join(', ') : 'sin conexiones',
    u.lastLoginAt ? `entró ${fmtRelativeTime(u.lastLoginAt)}` : 'no ha entrado',
  ]
    .filter(Boolean)
    .join(' · ');

const open = ref(false);
const saving = ref(false);
const editing = ref(null); // el usuario que se edita (null: uno nuevo)
const form = reactive({
  email: '',
  name: '',
  role: 'user',
  password: '',
  demo: false,
  expiresOn: '',
  features: [],
});
const created = ref(null); // { email, password }: la contraseña generada se enseña una vez

function edit(u = null) {
  editing.value = u;
  Object.assign(form, {
    email: u?.email ?? '',
    name: u?.name ?? '',
    role: u?.role ?? 'user',
    password: '',
    demo: u?.demo ?? false,
    expiresOn: u?.expiresAt ? toISODate(new Date(u.expiresAt)) : '',
    features: [...(u?.features ?? [])],
  });
  open.value = true;
}

// Una cuenta demo nueva caduca al mes (se puede cambiar o vaciar)
function toggleDemo(on) {
  form.demo = on;
  if (on && !editing.value && !form.expiresOn) form.expiresOn = addDays(todayISO(), DEMO_DAYS);
}

function toggleFeature(id, on) {
  form.features = on ? [...form.features, id] : form.features.filter((f) => f !== id);
}

const isMe = computed(() => editing.value?.id === me.value?.id);
const valid = computed(
  () =>
    (editing.value || form.email.includes('@')) && (!form.password || form.password.length >= 8),
);

async function call(action, done) {
  saving.value = true;
  try {
    const result = await action();
    reload.value++;
    open.value = false;
    if (done) toast.show(done);
    return result;
  } catch (err) {
    toast.show(`No se ha guardado (${err.message})`, 'critical');
  } finally {
    saving.value = false;
  }
}

async function save() {
  const input = {
    name: form.name.trim() || null,
    role: form.role,
    demo: form.demo,
    expiresAt: endOfDayISO(form.expiresOn),
    features: form.features,
    ...(form.password && { password: form.password }),
  };
  if (editing.value) return call(() => updateUser(editing.value.id, input), 'Guardado');
  const result = await call(() => createUser({ ...input, email: form.email.trim() }));
  if (result) {
    created.value = { email: result.user.email, password: result.generatedPassword ?? null };
  }
}

const setDisabled = (disabled) =>
  call(
    () => updateUser(editing.value.id, { disabled }),
    disabled ? 'Desactivado: ya no puede entrar' : 'Activado de nuevo',
  );

async function remove() {
  const u = editing.value;
  const ok = await ask({
    title: `¿Borrar a ${u.email}?`,
    message:
      'Se borran también todos sus datos (timeline, conexiones, comidas, coach, informes…). No se puede deshacer. Si solo quieres que no entre, desactívalo.',
    confirmLabel: 'Borrar',
    danger: true,
  });
  if (ok) call(() => deleteUser(u.id), 'Usuario borrado');
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast.show('Copiado');
  } catch {
    toast.show('No se ha podido copiar: selecciónalo a mano', 'critical');
  }
}
</script>

<template>
  <div class="admin">
    <AdminHeader
      title="Usuarios"
      description="Quién puede entrar, con qué funciones extra, y las cuentas demo para enseñar el producto (sin informe ni avisos, y con caducidad)."
    />

    <div v-if="created" class="card created">
      <strong>Creado: {{ created.email }}</strong>
      <template v-if="created.password">
        <p class="muted">Contraseña generada. Cópiala ahora: no se vuelve a enseñar.</p>
        <div class="secret">
          <code>{{ created.password }}</code>
          <button class="btn btn-sm" @click="copy(created.password)">
            <Copy class="icon icon-sm" /> Copiar
          </button>
        </div>
      </template>
      <button class="btn btn-ghost btn-sm" @click="created = null">Hecho</button>
    </div>

    <p v-if="error" class="card error">
      No se han podido cargar los usuarios ({{ error.message }}).
    </p>
    <div v-else-if="data || !loading" class="card list">
      <button v-for="u in users" :key="u.id" type="button" class="row" @click="edit(u)">
        <UserRound class="icon" :class="{ muted: !u.active }" />
        <span class="what">
          <span class="name" :class="{ muted: !u.active }">
            {{ u.name || u.email }}
            <span v-if="u.id === me?.id" class="muted">(tú)</span>
          </span>
          <span class="muted">{{ u.name ? `${u.email} · ` : '' }}{{ detail(u) }}</span>
        </span>
        <StatusPill v-bind="status(u)" />
        <ChevronRight class="icon icon-sm muted" />
      </button>
      <button type="button" class="row add" @click="edit()">
        <Plus class="icon" />
        Nuevo usuario
      </button>
    </div>

    <Modal
      :open="open"
      :title="editing ? editing.email : 'Nuevo usuario'"
      :width="480"
      @close="open = false"
    >
      <form id="user-form" class="form" @submit.prevent="save">
        <label v-if="!editing" class="field">
          <span>Email</span>
          <input v-model="form.email" class="input" type="email" autocomplete="off" required />
        </label>
        <div class="pair">
          <label class="field">
            <span>Nombre (opcional)</span>
            <input v-model="form.name" class="input" maxlength="80" />
          </label>
          <label class="field">
            <span>Rol</span>
            <select v-model="form.role" class="input" :disabled="isMe">
              <option value="user">Usuario</option>
              <option value="admin">Administrador</option>
            </select>
          </label>
        </div>
        <label class="field">
          <span>{{
            editing ? 'Contraseña nueva (opcional)' : 'Contraseña (vacía: se genera una)'
          }}</span>
          <PasswordInput v-model="form.password" autocomplete="new-password" :required="false" />
        </label>
        <p v-if="form.password && form.password.length < 8" class="muted hint">
          Mínimo 8 caracteres.
        </p>

        <ul class="card toggles">
          <li>
            <label class="toggle">
              <span class="text">
                <strong>Cuenta demo</strong>
                <span class="muted"
                  >Para enseñar el producto: sin informe por correo ni avisos push.</span
                >
              </span>
              <input
                type="checkbox"
                role="switch"
                class="switch"
                :checked="form.demo"
                @change="toggleDemo($event.target.checked)"
              />
            </label>
          </li>
          <li v-for="f in features" :key="f.id">
            <label class="toggle">
              <span class="text">
                <strong>{{ f.label }}</strong>
                <span class="muted">{{
                  form.role === 'admin'
                    ? `${f.description}. Los administradores ya la tienen.`
                    : f.description
                }}</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                class="switch"
                :checked="form.role === 'admin' || form.features.includes(f.id)"
                :disabled="form.role === 'admin'"
                @change="toggleFeature(f.id, $event.target.checked)"
              />
            </label>
          </li>
        </ul>

        <label class="field">
          <span>Puede entrar hasta (vacío: sin fecha)</span>
          <input v-model="form.expiresOn" class="input" type="date" :min="todayISO()" />
        </label>
      </form>

      <template #footer>
        <template v-if="editing && !isMe">
          <button class="btn btn-ghost danger" type="button" :disabled="saving" @click="remove">
            Borrar
          </button>
          <button
            class="btn"
            type="button"
            :disabled="saving"
            @click="setDisabled(!editing.disabledAt)"
          >
            {{ editing.disabledAt ? 'Activar' : 'Desactivar' }}
          </button>
        </template>
        <button class="btn btn-primary" type="submit" form="user-form" :disabled="saving || !valid">
          {{ saving ? 'Guardando…' : editing ? 'Guardar' : 'Crear' }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.admin {
  max-width: 920px;
  margin: 0 auto;
}

.list {
  display: grid;
  overflow: hidden;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 56px;
  padding: 10px 16px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.row:last-child {
  border-bottom: 0;
}

.row:hover {
  background: var(--surface-hover);
}

.what {
  display: grid;
  flex: 1;
  min-width: 0;
}

.what > .muted {
  font-size: 12px;
  overflow-wrap: anywhere;
}

.add {
  color: var(--text-2);
}

.error {
  padding: 14px 16px;
  color: var(--critical-text);
}

.created {
  display: grid;
  gap: 8px;
  padding: 14px 16px;
  margin-bottom: 12px;
  font-size: 13px;
}

.secret {
  display: flex;
  align-items: center;
  gap: 8px;
}

.secret code {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.form {
  display: grid;
  gap: 14px;
}

.pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}

.hint {
  margin-top: -8px;
  font-size: 12px;
}

.toggles {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: hidden;
}

.toggles li + li {
  border-top: 1px solid var(--border);
}

.toggle {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  cursor: pointer;
}

.toggle .text {
  display: grid;
  flex: 1;
  min-width: 0;
  font-size: 13px;
}

.toggle .muted {
  font-size: 12px;
}

.danger {
  margin-right: auto;
  color: var(--critical-text);
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

.switch:disabled {
  opacity: 0.5;
  cursor: default;
}

.switch:focus-visible {
  outline: 2px solid var(--text);
  outline-offset: 2px;
}

@media (max-width: 560px) {
  .row :deep(.pill) {
    display: none;
  }
}
</style>
