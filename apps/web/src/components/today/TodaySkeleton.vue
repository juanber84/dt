<script setup>
import Skeleton from '../ui/Skeleton.vue';

/** Hoy mientras carga: la misma rejilla con bloques vacíos (nada inventado). */
</script>

<template>
  <section class="scores">
    <div v-for="n in 3" :key="n" class="card score">
      <Skeleton circle height="116px" />
      <div class="score-text score-text-skeleton">
        <Skeleton width="55%" height="10px" />
        <Skeleton width="45%" height="20px" radius="10px" />
        <Skeleton width="85%" />
      </div>
    </div>
  </section>
  <section class="vitals">
    <div v-for="n in 6" :key="n" class="card vital-skeleton">
      <Skeleton width="60%" height="10px" />
      <Skeleton width="45%" height="26px" />
      <Skeleton width="70%" height="10px" />
      <Skeleton height="28px" />
    </div>
  </section>
  <section class="card card-pad">
    <header class="col-head"><h2>Tu día</h2></header>
    <Skeleton height="120px" radius="8px" />
  </section>
  <div class="columns">
    <section class="card card-pad">
      <header class="col-head"><h2>Timeline</h2></header>
      <div class="rows-skeleton">
        <div v-for="n in 5" :key="n" class="row-skeleton">
          <Skeleton width="44px" />
          <Skeleton circle height="28px" />
          <Skeleton :width="`${40 + ((n * 17) % 40)}%`" />
        </div>
      </div>
    </section>
    <div class="side">
      <section v-for="title in ['Actividad', 'Nutrición']" :key="title" class="card card-pad">
        <header class="col-head">
          <h2>{{ title }}</h2>
        </header>
        <div class="rows-skeleton">
          <Skeleton width="40%" height="28px" />
          <Skeleton height="8px" radius="4px" />
          <Skeleton width="80%" />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped src="./layout.css"></style>
<style scoped src="./card.css"></style>
<style scoped>
.score-text-skeleton {
  flex: 1;
  min-width: 0;
  width: 100%;
}

.vital-skeleton {
  display: grid;
  gap: 10px;
  padding: 16px;
}

.rows-skeleton {
  display: grid;
  gap: 16px;
}

.row-skeleton {
  display: flex;
  align-items: center;
  gap: 12px;
}

@media (max-width: 860px) {
  .score > .skeleton {
    width: 76px !important;
    height: 76px !important;
  }
}
</style>
