<script setup>
import { useAuth } from '../../composables/useAuth.js';

const { isAdmin } = useAuth();

defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
});
</script>

<template>
  <header class="admin-head">
    <p class="section-label">{{ isAdmin ? 'Administración' : 'Ajustes' }}</p>
    <h1>{{ title }}</h1>
    <p v-if="description" class="secondary">{{ description }}</p>
    <nav class="tabs" aria-label="Administración">
      <RouterLink to="/settings" active-class="active">Cuenta</RouterLink>
      <RouterLink to="/admin/connections" active-class="active">Conexiones</RouterLink>
      <template v-if="isAdmin">
        <RouterLink to="/admin/sources" active-class="active">Fuentes</RouterLink>
        <RouterLink to="/admin/ai" active-class="active">IA</RouterLink>
        <RouterLink to="/admin/system" active-class="active">Sistema</RouterLink>
      </template>
    </nav>
  </header>
</template>

<style scoped>
.admin-head {
  display: grid;
  gap: 4px;
  margin-bottom: 20px;
}

.admin-head > .secondary {
  max-width: 640px;
}

/* En móvil no hay barra lateral: estas pestañas cambian de sección */
.tabs {
  display: none;
  gap: 6px;
  margin-top: 12px;
}

.tabs a {
  height: 30px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-2);
}

.tabs a.active {
  background: var(--text);
  color: var(--inverse);
  border-color: var(--text);
}

@media (max-width: 860px) {
  .tabs {
    display: flex;
  }
}
</style>
