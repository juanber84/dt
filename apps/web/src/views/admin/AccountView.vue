<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { LogOut } from '@lucide/vue';
import AdminHeader from '../../components/admin/AdminHeader.vue';
import Segmented from '../../components/ui/Segmented.vue';
import { useAuth, signOut } from '../../composables/useAuth.js';
import { useTheme } from '../../composables/useTheme.js';

const { user, isAdmin } = useAuth();
const { theme } = useTheme();
const router = useRouter();
const leaving = ref(false);

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

    <h2 class="sub">Apariencia</h2>
    <p class="secondary sub-desc">"Sistema" sigue el modo claro u oscuro del dispositivo.</p>
    <Segmented v-model="theme" :options="THEMES" label="Tema" />

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
