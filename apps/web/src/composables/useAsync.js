import { ref, toValue, watch } from 'vue';

/**
 * Carga datos cada vez que cambia `source` (p. ej. la fecha de la ruta). Ignora respuestas que
 * llegan tarde si entretanto se pidió otra cosa. Mientras carga se queda lo anterior (sin
 * parpadeos); `reload()` vuelve a pedirlo.
 */
export function useAsync(source, loader) {
  const data = ref(null);
  const error = ref(null);
  const loading = ref(false);
  let ticket = 0;

  async function run(value) {
    const mine = ++ticket;
    loading.value = true;
    error.value = null;
    try {
      const result = await loader(value);
      if (mine === ticket) data.value = result;
    } catch (err) {
      if (mine === ticket) error.value = err;
    } finally {
      if (mine === ticket) loading.value = false;
    }
  }

  watch(source, run, { immediate: true });

  return { data, error, loading, reload: () => run(toValue(source)) };
}
