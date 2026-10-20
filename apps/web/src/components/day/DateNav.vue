<script setup>
import { computed, ref } from 'vue';
import { ChevronLeft, ChevronRight, CalendarDays } from '@lucide/vue';
import { addDays, formatLongDate, relativeDayLabel, todayISO } from '../../lib/dates.js';

const props = defineProps({ date: { type: String, required: true } });
const emit = defineEmits(['change']);

const today = todayISO();
const relative = computed(() => relativeDayLabel(props.date, today));
const picker = ref(null);

function openPicker() {
  picker.value?.showPicker?.() ?? picker.value?.click();
}

// El input oculto se queda con el foco tras elegir: se suelta para que no deje un cursor
function pick(event) {
  const { value } = event.target;
  event.target.blur();
  if (value) emit('change', value);
}
</script>

<template>
  <!-- Los controles van delante del título: así no se mueven al cambiar de "Hoy" a un día largo -->
  <div class="date-nav">
    <div class="controls">
      <button
        class="btn btn-icon"
        aria-label="Día anterior"
        @click="emit('change', addDays(date, -1))"
      >
        <ChevronLeft class="icon" />
      </button>
      <button
        class="btn btn-icon"
        aria-label="Día siguiente"
        :disabled="date >= today"
        @click="emit('change', addDays(date, 1))"
      >
        <ChevronRight class="icon" />
      </button>
      <span class="picker">
        <button class="btn btn-icon" aria-label="Elegir fecha" @click="openPicker">
          <CalendarDays class="icon" />
        </button>
        <input
          ref="picker"
          type="date"
          :max="today"
          :value="date"
          tabindex="-1"
          aria-hidden="true"
          @change="pick"
        />
      </span>
      <!-- Siempre ocupa su sitio (invisible en hoy) para no empujar el título al aparecer -->
      <button
        class="btn"
        :class="{ hidden: date === today }"
        :tabindex="date === today ? -1 : 0"
        :aria-hidden="date === today"
        @click="emit('change', today)"
      >
        Hoy
      </button>
    </div>
    <div class="labels">
      <h1>{{ relative ?? formatLongDate(date).replace(/^./, (c) => c.toUpperCase()) }}</h1>
      <p class="muted">
        {{
          relative ? formatLongDate(date).replace(/^./, (c) => c.toUpperCase()) : date.slice(0, 4)
        }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.date-nav {
  display: flex;
  align-items: center;
  gap: 16px;
}

.labels {
  min-width: 0;
}

.labels p {
  margin-top: 2px;
  font-size: 13px;
}

.controls {
  display: flex;
  flex: none;
  gap: 6px;
}

.controls .hidden {
  visibility: hidden;
}

.picker {
  position: relative;
}

@media (max-width: 860px) {
  .date-nav {
    flex: 1;
    min-width: 0;
    gap: 10px;
  }

  /* El título delante (en el móvil no cabe todo en una fila) y las flechas a la derecha */
  .labels {
    order: -1;
    flex: 1;
  }

  /* Un día largo ("Miércoles, 15 de octubre") pasa a dos líneas en vez de cortarse */
  .labels h1 {
    font-size: 20px;
    line-height: 1.15;
  }

  .labels p {
    font-size: 12px;
  }

  /* "Hoy" no reserva hueco: solo aparece cuando estás en otro día */
  .controls .hidden {
    display: none;
  }
}

.picker input {
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;
  /* Chrome pinta el cursor de texto aunque el input sea invisible */
  caret-color: transparent;
}
</style>
