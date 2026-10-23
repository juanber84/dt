<script setup>
import { ref } from 'vue';
import { ChevronRight, FileText } from '@lucide/vue';
import { useAsync } from '../composables/useAsync.js';
import CardSkeleton from '../components/ui/CardSkeleton.vue';
import { listReports, reportDay } from '../services/reports.js';

/** Informes: el de cada mañana (y los que pidas al coach), del más nuevo al más viejo. */
const { data, error, reload } = useAsync(ref(0), listReports);
</script>

<template>
  <div class="reports">
    <header class="page-head">
      <h1>Informes</h1>
      <p class="muted">Cada mañana, lo de ayer. Te llegan también por correo.</p>
    </header>

    <div v-if="error" class="card card-pad" role="alert">
      <p>No se han podido cargar ({{ error.message }}).</p>
      <button class="btn" @click="reload">Reintentar</button>
    </div>
    <CardSkeleton v-else-if="!data" />
    <p v-else-if="!data.items.length" class="card card-pad muted">
      Aún no hay ninguno. El primero llegará mañana por la mañana; o pídelo ya en Ajustes → Cuenta →
      Correo.
    </p>
    <ul v-else class="card list">
      <li v-for="r in data.items" :key="r.id">
        <RouterLink :to="`/reports/${r.id}`">
          <FileText class="icon" />
          <span class="text">
            <strong>{{ r.title }}</strong>
            <span class="muted">{{
              r.kind === 'daily' ? 'Informe de la mañana' : reportDay(r.periodFrom)
            }}</span>
          </span>
          <ChevronRight class="icon icon-sm muted" />
        </RouterLink>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.page-head {
  margin-bottom: 16px;
}

.page-head p {
  margin-top: 2px;
}

.list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.list li + li {
  border-top: 1px solid var(--border);
}

.list a {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  color: inherit;
  text-decoration: none;
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

.text strong::first-letter {
  text-transform: uppercase;
}
</style>
