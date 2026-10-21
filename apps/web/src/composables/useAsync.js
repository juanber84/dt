import { computed, ref, toValue, watch } from 'vue';

/**
 * Carga datos cada vez que cambia `source` (p. ej. la fecha de la ruta). Ignora respuestas que
 * llegan tarde si entretanto se pidió otra cosa. `reload()` vuelve a pedirlo y deja lo que hay
 * en pantalla mientras tanto; `stale` dice que lo que hay es de otra cosa (otro día, otro rango)
 * y se está cargando lo nuevo: entonces la vista enseña el esqueleto, no los datos viejos.
 */
export function useAsync(source, loader) {
  const data = ref(null);
  const error = ref(null);
  const loading = ref(false);
  const loadedFor = ref(undefined);
  const requested = ref(undefined);
  let ticket = 0;

  async function run(value) {
    const mine = ++ticket;
    requested.value = value;
    loading.value = true;
    error.value = null;
    try {
      const result = await loader(value);
      if (mine === ticket) {
        data.value = result;
        loadedFor.value = value;
      }
    } catch (err) {
      if (mine === ticket) error.value = err;
    } finally {
      if (mine === ticket) loading.value = false;
    }
  }

  watch(source, run, { immediate: true });

  const stale = computed(
    () => loading.value && (data.value == null || loadedFor.value !== requested.value),
  );

  return { data, error, loading, stale, reload: () => run(toValue(source)) };
}
