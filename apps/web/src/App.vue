<script setup>
import BrandMark from './components/ui/BrandMark.vue';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  CalendarDays,
  TrendingUp,
  Activity,
  Plug,
  Layers,
  Server,
  Sun,
  MoonStar,
  Settings,
  LogOut,
  Sparkles,
  BrainCircuit,
  FileHeart,
} from '@lucide/vue';
import Toast from './components/ui/Toast.vue';
import { useTheme } from './composables/useTheme.js';
import { useAuth, signOut } from './composables/useAuth.js';
import { fetchSystemStatus } from './services/twin.js';

const { toggle, isDark, theme } = useTheme();
const { user, isAdmin } = useAuth();
const router = useRouter();

async function exit() {
  await signOut().catch(() => {});
  router.replace({ name: 'login' });
}
const apiStatus = ref('checking');

onMounted(async () => {
  try {
    await fetchSystemStatus();
    apiStatus.value = 'ok';
  } catch {
    apiStatus.value = 'down';
  }
});

const main = [
  { to: '/day', label: 'Hoy', icon: CalendarDays, match: '/day' },
  { to: '/trends', label: 'Tendencias', icon: TrendingUp, match: '/trends' },
  { to: '/training', label: 'Entrenos', icon: Activity, match: '/training' },
  { to: '/clinical', label: 'Clínica', icon: FileHeart, match: '/clinical' },
  { to: '/coach', label: 'Coach', icon: Sparkles, match: '/coach' },
];
const settings = [{ to: '/admin/connections', label: 'Conexiones', icon: Plug }];
// Solo admin: qué fuentes entran y en qué orden, y el estado del sistema
const admin = [
  { to: '/admin/sources', label: 'Fuentes', icon: Layers },
  { to: '/admin/ai', label: 'IA', icon: BrainCircuit },
  { to: '/admin/system', label: 'Sistema', icon: Server },
];
</script>

<template>
  <RouterView v-if="$route.meta.bare" />
  <div v-else class="shell">
    <aside class="sidebar">
      <RouterLink to="/day" class="brand">
        <BrandMark :size="24" />
        Digital Twin
      </RouterLink>

      <nav aria-label="Principal">
        <RouterLink
          v-for="item in main"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          :class="{ active: $route.path.startsWith(item.match) }"
        >
          <component :is="item.icon" class="icon" />
          {{ item.label }}
        </RouterLink>
      </nav>

      <nav aria-label="Ajustes">
        <p class="nav-title">Ajustes</p>
        <RouterLink
          v-for="item in settings"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          active-class="active"
        >
          <component :is="item.icon" class="icon" />
          {{ item.label }}
        </RouterLink>
      </nav>

      <nav v-if="isAdmin" aria-label="Administración">
        <p class="nav-title">Administración</p>
        <RouterLink
          v-for="item in admin"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          active-class="active"
        >
          <component :is="item.icon" class="icon" />
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="sidebar-foot">
        <div v-if="user" class="me">
          <span class="avatar" aria-hidden="true">{{ (user.name ?? user.email)[0] }}</span>
          <span class="who">
            <strong>{{ user.name ?? user.email }}</strong>
            <span class="muted">{{ isAdmin ? 'Administrador' : user.email }}</span>
          </span>
          <button
            class="btn btn-ghost btn-icon btn-sm"
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
            @click="exit"
          >
            <LogOut class="icon icon-sm" />
          </button>
        </div>
        <div class="foot-row">
          <span class="api" :class="apiStatus">
            <span class="dot" />
            API
            {{ apiStatus === 'ok' ? 'conectada' : apiStatus === 'down' ? 'sin respuesta' : '…' }}
          </span>
          <button
            class="btn btn-ghost btn-icon btn-sm"
            :aria-label="`Tema: ${theme}`"
            title="Cambiar tema"
            @click="toggle"
          >
            <Sun v-if="isDark()" class="icon icon-sm" />
            <MoonStar v-else class="icon icon-sm" />
          </button>
        </div>
      </div>
    </aside>

    <main class="content">
      <RouterView />
    </main>

    <nav class="tabbar" aria-label="Principal">
      <RouterLink
        v-for="item in main"
        :key="item.to"
        :to="item.to"
        :class="{ active: $route.path.startsWith(item.match) }"
      >
        <component :is="item.icon" class="icon" />
        {{ item.label }}
      </RouterLink>
      <RouterLink to="/admin/connections" :class="{ active: $route.path.startsWith('/admin') }">
        <Settings class="icon" />
        Ajustes
      </RouterLink>
    </nav>
  </div>
  <Toast />
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: 232px 1fr;
  min-height: 100dvh;
}

.sidebar {
  position: sticky;
  top: 0;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: 18px 12px;
  border-right: 1px solid var(--border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

nav {
  display: grid;
  gap: 2px;
}

.nav-title {
  padding: 0 10px 6px;
  font-size: 12px;
  color: var(--muted);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 34px;
  padding: 0 10px;
  border-radius: 8px;
  color: var(--text-2);
  font-weight: 500;
}

.nav-item:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.nav-item.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: inset 0 0 0 1px var(--border);
}

.sidebar-foot {
  margin-top: auto;
  display: grid;
  gap: 10px;
  padding: 0 4px;
}

.me {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 8px 0 10px;
  border-bottom: 1px solid var(--border);
}

.avatar {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
}

.who {
  display: grid;
  min-width: 0;
  font-size: 12px;
  line-height: 1.3;
}

.who > * {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.foot-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.api {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}

.api .dot {
  width: 7px;
  height: 7px;
  background: var(--axis);
}

.api.ok .dot {
  background: var(--good);
}

.api.down .dot {
  background: var(--critical);
}

.content {
  min-width: 0;
  padding: 28px 36px 64px;
}

.tabbar {
  display: none;
}

@media (max-width: 860px) {
  .shell {
    grid-template-columns: 1fr;
  }

  .sidebar {
    display: none;
  }

  .content {
    padding: 18px 16px 96px;
  }

  .tabbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 30;
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    padding: 6px 4px calc(6px + env(safe-area-inset-bottom));
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: blur(12px);
    border-top: 1px solid var(--border);
  }

  .tabbar a {
    display: grid;
    justify-items: center;
    gap: 2px;
    padding: 6px 0;
    font-size: 11px;
    color: var(--muted);
  }

  .tabbar a.active {
    color: var(--text);
  }
}
</style>
