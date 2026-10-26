<script setup>
import { Plus, X } from '@lucide/vue';
import { fmtRelativeTime } from '../../lib/format.js';

/** La lista de conversaciones: columna en escritorio, panel lateral en el móvil (`open`). */
defineProps({
  conversations: { type: Array, required: true },
  currentId: { type: String, default: null },
  unavailable: { type: Boolean, default: false },
  open: { type: Boolean, default: false },
});
defineEmits(['close']);
</script>

<template>
  <aside class="conversations" :class="{ open }" aria-label="Conversaciones">
    <div class="list-head">
      <h2>Conversaciones</h2>
      <button
        class="btn btn-ghost btn-icon btn-sm close-list"
        aria-label="Cerrar"
        @click="$emit('close')"
      >
        <X class="icon icon-sm" />
      </button>
    </div>
    <RouterLink :to="{ name: 'coach' }" class="btn new">
      <Plus class="icon" />
      Nueva conversación
    </RouterLink>
    <nav class="items">
      <RouterLink
        v-for="c in conversations"
        :key="c.id"
        :to="{ name: 'coach', params: { id: c.id } }"
        class="item"
        :class="{ active: currentId === c.id }"
      >
        <span class="item-title">{{ c.title }}</span>
        <span class="muted item-when">{{ fmtRelativeTime(c.updatedAt) }}</span>
      </RouterLink>
      <p v-if="!conversations.length && !unavailable" class="muted empty-list">
        Aún no has hablado con el coach.
      </p>
    </nav>
  </aside>
  <div class="scrim" :class="{ open }" @click="$emit('close')" />
</template>

<style scoped>
.conversations {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 4px 0;
}

.list-head h2 {
  font-size: 13px;
}

.new {
  justify-content: flex-start;
}

.items {
  display: grid;
  align-content: start;
  gap: 2px;
  overflow-y: auto;
  min-height: 0;
}

.item {
  display: grid;
  gap: 1px;
  padding: 7px 10px;
  border-radius: 8px;
  color: var(--text-2);
}

.item:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.item.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: inset 0 0 0 1px var(--border);
}

.item-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.item-when {
  font-size: 11px;
}

.empty-list {
  padding: 6px 10px;
  font-size: 12px;
}

.close-list,
.scrim {
  display: none;
}

@media (max-width: 860px) {
  .conversations {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 40;
    width: min(300px, 85vw);
    padding: max(16px, env(safe-area-inset-top)) 12px max(16px, env(safe-area-inset-bottom))
      max(12px, env(safe-area-inset-left));
    background: var(--page);
    border-right: 1px solid var(--border);
    transform: translateX(-100%);
    transition: transform 0.2s ease;
  }

  .conversations.open {
    transform: none;
  }

  .scrim.open {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 35;
    background: var(--overlay);
  }

  .close-list {
    display: inline-flex;
  }
}
</style>
