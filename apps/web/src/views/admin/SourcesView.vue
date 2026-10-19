<script setup>
import { ArrowUp, ArrowDown, RotateCcw } from '@lucide/vue';
import AdminHeader from '../../components/admin/AdminHeader.vue';
import SourceBadge from '../../components/ui/SourceBadge.vue';
import { useSourcePriority } from '../../composables/useSourcePriority.js';
import { DATA_TYPES, sourceName } from '../../data/sources.js';

const { priority, move, reset } = useSourcePriority();
const types = Object.entries(DATA_TYPES).filter(([type]) => priority[type]?.length > 1);
const single = Object.entries(DATA_TYPES).filter(([type]) => priority[type]?.length === 1);
</script>

<template>
  <div class="admin">
    <AdminHeader
      title="Prioridad de fuentes"
      description="Cuando dos fuentes registran lo mismo (el pesaje de la báscula y su copia en Google, el entreno en Strava y en intervals.icu) se guardan los dos registros, y en el timeline manda el de la fuente que esté más arriba."
    />

    <div class="toolbar">
      <span class="muted">Se guarda en este navegador hasta que la API tenga dónde guardarlo.</span>
      <button class="btn btn-sm btn-ghost" @click="reset">
        <RotateCcw class="icon icon-sm" />
        Restablecer
      </button>
    </div>

    <div class="grid">
      <section v-for="[type, label] in types" :key="type" class="card group">
        <h2>{{ label }}</h2>
        <ol>
          <li v-for="(id, i) in priority[type]" :key="id">
            <span class="rank num">{{ i + 1 }}</span>
            <SourceBadge :source="id" :size="24" />
            <span class="name">{{ sourceName(id) }}</span>
            <span v-if="i === 0" class="primary">Principal</span>
            <span class="moves">
              <button
                class="btn btn-ghost btn-icon btn-sm"
                :disabled="i === 0"
                :aria-label="`Subir ${sourceName(id)}`"
                @click="move(type, i, -1)"
              >
                <ArrowUp class="icon icon-sm" />
              </button>
              <button
                class="btn btn-ghost btn-icon btn-sm"
                :disabled="i === priority[type].length - 1"
                :aria-label="`Bajar ${sourceName(id)}`"
                @click="move(type, i, 1)"
              >
                <ArrowDown class="icon icon-sm" />
              </button>
            </span>
          </li>
        </ol>
      </section>
    </div>

    <p class="single muted">
      Con una sola fuente:
      {{
        single.map(([type, label]) => `${label} (${sourceName(priority[type][0])})`).join(' · ')
      }}.
    </p>
  </div>
</template>

<style scoped>
.admin {
  max-width: 920px;
  margin: 0 auto;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  font-size: 12px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.group {
  padding: 16px 16px 10px;
}

.group h2 {
  margin-bottom: 10px;
}

ol {
  margin: 0;
  padding: 0;
  list-style: none;
}

li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
}

li + li {
  border-top: 1px solid var(--grid);
}

.rank {
  width: 14px;
  color: var(--muted);
  font-size: 12px;
}

.name {
  flex: 1;
  font-size: 13px;
}

.primary {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--text);
  color: var(--inverse);
}

.moves {
  display: flex;
}

.single {
  margin-top: 16px;
  font-size: 12px;
}
</style>
