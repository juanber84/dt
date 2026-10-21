import { computed, ref } from 'vue';

/**
 * Cuántas cosas están cargando ahora (llamadas a la API, cambio de pantalla). La barra fina de
 * arriba (TopProgress) se enseña mientras haya alguna.
 */
const pending = ref(0);

export const isBusy = computed(() => pending.value > 0);

/** Empieza una carga; devuelve la función que la termina (llamarla dos veces no descuenta dos). */
export function startProgress() {
  pending.value++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    pending.value--;
  };
}
