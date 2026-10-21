<script setup>
import Skeleton from './Skeleton.vue';

/** Tarjeta de gráfica o lista mientras carga: título, cifra y un bloque (o filas). */
defineProps({
  chart: { type: String, default: '160px' },
  rows: { type: Number, default: 0 },
});
</script>

<template>
  <section class="card card-pad card-skeleton" aria-hidden="true">
    <header>
      <div class="titles">
        <Skeleton width="140px" height="14px" />
        <Skeleton width="220px" height="10px" />
      </div>
      <Skeleton v-if="!rows" width="70px" height="24px" />
    </header>
    <div v-if="rows" class="rows">
      <div v-for="n in rows" :key="n" class="row">
        <Skeleton circle height="30px" />
        <Skeleton :width="`${45 + ((n * 23) % 40)}%`" />
        <Skeleton width="48px" />
      </div>
    </div>
    <Skeleton v-else :height="chart" radius="8px" />
  </section>
</template>

<style scoped>
.card-skeleton {
  display: grid;
  gap: 18px;
}

header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.titles {
  display: grid;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.rows {
  display: grid;
  gap: 16px;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.row > :nth-child(2) {
  flex: 1;
}
</style>
