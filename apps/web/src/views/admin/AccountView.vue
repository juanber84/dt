<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { LogOut, ScanFace, Trash2 } from '@lucide/vue';
import AdminHeader from '../../components/admin/AdminHeader.vue';
import Segmented from '../../components/ui/Segmented.vue';
import NotificationSettings from '../../components/admin/NotificationSettings.vue';
import ProfileSettings from '../../components/admin/ProfileSettings.vue';
import McpTokens from '../../components/admin/McpTokens.vue';
import { useAuth, signOut } from '../../composables/useAuth.js';
import { useTheme } from '../../composables/useTheme.js';
import { useConfirm } from '../../composables/useConfirm.js';
import { useToast } from '../../composables/useToast.js';
import {
  addPasskey,
  cancelled,
  deletePasskey,
  deviceName,
  listPasskeys,
  supportsPasskeys,
} from '../../services/auth.js';
import { fmtRelativeTime } from '../../lib/format.js';

const { user, isAdmin } = useAuth();
const { theme } = useTheme();
const router = useRouter();
const leaving = ref(false);
const { ask } = useConfirm();
const toast = useToast();

// --- Face ID (passkeys) ---
const canPasskey = supportsPasskeys();
const passkeys = ref(null);
const adding = ref(false);

async function loadPasskeys() {
  try {
    passkeys.value = await listPasskeys();
  } catch {
    passkeys.value = [];
  }
}
onMounted(loadPasskeys);

async function add() {
  adding.value = true;
  try {
    await addPasskey(deviceName());
    toast.show('Listo: ya puedes entrar con Face ID desde este dispositivo', 'good');
    await loadPasskeys();
  } catch (err) {
    // Ya dado de alta: el dispositivo lo dice con InvalidStateError
    if (err?.name === 'InvalidStateError') {
      toast.show('Este dispositivo ya tiene Face ID activado');
    } else if (!cancelled(err)) {
      toast.show(err.status ? err.message : 'No se ha podido activar Face ID', 'critical');
    }
  } finally {
    adding.value = false;
  }
}

async function remove(passkey) {
  const ok = await ask({
    title: `¿Quitar ${passkey.name}?`,
    message: 'Desde ahí tendrás que entrar con contraseña hasta que lo vuelvas a activar.',
    confirmLabel: 'Quitar',
    danger: true,
  });
  if (!ok) return;
  await deletePasskey(passkey.id).catch(() => {});
  await loadPasskeys();
}

const THEMES = [
  { value: 'dark', label: 'Oscuro' },
  { value: 'light', label: 'Claro' },
  { value: 'system', label: 'Sistema' },
];

async function exit() {
  leaving.value = true;
  await signOut().catch(() => {});
  router.replace({ name: 'login' });
}
</script>

<template>
  <div class="admin">
    <AdminHeader title="Cuenta" description="Tu sesión y cómo se ve la app." />

    <section v-if="user" class="card row">
      <span class="avatar" aria-hidden="true">{{ (user.name ?? user.email)[0] }}</span>
      <div class="who">
        <strong>{{ user.name ?? user.email }}</strong>
        <span class="secondary">{{ user.email }}</span>
        <span v-if="isAdmin" class="muted">Administrador</span>
      </div>
    </section>

    <ProfileSettings />

    <h2 class="sub">Apariencia</h2>
    <p class="secondary sub-desc">"Sistema" sigue el modo claro u oscuro del dispositivo.</p>
    <Segmented v-model="theme" :options="THEMES" label="Tema" />

    <h2 class="sub">Face ID</h2>
    <p class="secondary sub-desc">
      Entra sin contraseña con la cara o la huella. Actívalo en cada dispositivo; si usas el llavero
      de iCloud, vale también en tus otros dispositivos de Apple.
    </p>
    <ul v-if="passkeys?.length" class="card passkeys">
      <li v-for="p in passkeys" :key="p.id" class="passkey-row">
        <ScanFace class="icon" />
        <div class="who">
          <strong>{{ p.name }}</strong>
          <span class="muted">
            {{ p.synced ? 'En tu llavero' : 'Solo este dispositivo' }} ·
            {{ p.lastUsedAt ? `usada ${fmtRelativeTime(p.lastUsedAt)}` : 'sin usar todavía' }}
          </span>
        </div>
        <button
          class="btn btn-ghost btn-icon btn-sm"
          :aria-label="`Quitar ${p.name}`"
          title="Quitar"
          @click="remove(p)"
        >
          <Trash2 class="icon icon-sm" />
        </button>
      </li>
    </ul>
    <button v-if="canPasskey" class="btn add-passkey" :disabled="adding" @click="add">
      <ScanFace class="icon icon-sm" />
      {{ adding ? 'Esperando a Face ID…' : 'Activar Face ID en este dispositivo' }}
    </button>
    <p v-else class="muted">Este navegador no admite passkeys.</p>

    <NotificationSettings />

    <McpTokens />

    <button class="btn btn-danger logout" :disabled="leaving" @click="exit">
      <LogOut class="icon icon-sm" />
      Cerrar sesión
    </button>
  </div>
</template>

<style scoped>
.admin {
  max-width: 920px;
  margin: 0 auto;
}

.row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
}

.avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  font-size: 18px;
  font-weight: 600;
  text-transform: uppercase;
}

.who {
  display: grid;
  min-width: 0;
  gap: 2px;
  font-size: 13px;
}

.who > * {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.who strong {
  font-size: 15px;
}

.sub {
  margin: 32px 0 4px;
  font-size: 15px;
}

.sub-desc {
  margin-bottom: 12px;
  font-size: 13px;
}

.passkeys {
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
}

.passkey-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
}

.passkey-row + .passkey-row {
  border-top: 1px solid var(--border);
}

.passkey-row .who {
  flex: 1;
}

.add-passkey {
  gap: 8px;
}

.logout {
  display: flex;
  justify-content: center;
  gap: 8px;
  width: 100%;
  max-width: 320px;
  margin-top: 40px;
}

@media (max-width: 860px) {
  .logout {
    max-width: none;
  }
}
</style>
