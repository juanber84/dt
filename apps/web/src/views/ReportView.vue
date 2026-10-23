<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { ChevronLeft } from '@lucide/vue';
import { useAsync } from '../composables/useAsync.js';
import CardSkeleton from '../components/ui/CardSkeleton.vue';
import ReportBlocks from '../components/reports/ReportBlocks.vue';
import { fetchReport } from '../services/reports.js';

/** Un informe, con sus gráficas interactivas (el correo lleva el mismo en imágenes). */
const route = useRoute();
const id = computed(() => route.params.id);
const { data: report, error, reload } = useAsync(id, fetchReport);
const created = computed(() =>
  report.value
    ? new Intl.DateTimeFormat('es-ES', {
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(report.value.createdAt))
    : '',
);
</script>

<template>
  <div class="report">
    <RouterLink to="/reports" class="back muted"
      ><ChevronLeft class="icon icon-sm" /> Informes</RouterLink
    >

    <div v-if="error" class="card card-pad" role="alert">
      <p>
        {{
          error.status === 404
            ? 'Ese informe no existe.'
            : `No se ha podido cargar (${error.message}).`
        }}
      </p>
      <button v-if="error.status !== 404" class="btn" @click="reload">Reintentar</button>
    </div>
    <CardSkeleton v-else-if="!report" />
    <template v-else>
      <header class="page-head">
        <h1>{{ report.title }}</h1>
        <p class="muted">Hecho el {{ created }}</p>
      </header>
      <ReportBlocks :blocks="report.blocks" />
    </template>
  </div>
</template>

<style scoped>
.report {
  max-width: 720px;
}

.back {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-bottom: 8px;
  font-size: 13px;
  text-decoration: none;
}

.page-head {
  margin-bottom: 12px;
}

.page-head h1::first-letter {
  text-transform: uppercase;
}

.page-head p {
  margin-top: 2px;
}
</style>
