import { onBeforeUnmount, onMounted, ref } from 'vue';

/** Ancho en px de un elemento, actualizado al redimensionar (las gráficas dibujan en px reales). */
export function useElementWidth(el, fallback = 300) {
  const width = ref(fallback);
  let observer;
  onMounted(() => {
    if (!el.value) return;
    width.value = el.value.clientWidth || fallback;
    if (typeof ResizeObserver === 'undefined') return;
    // Oculto (v-show, pestaña sin pintar) mide 0: se queda el último ancho, si no las gráficas
    // salen con anchos negativos (x(fin) - x(inicio) < 0 al restar los márgenes)
    observer = new ResizeObserver(([entry]) => {
      const next = Math.floor(entry.contentRect.width);
      if (next > 0) width.value = next;
    });
    observer.observe(el.value);
  });
  onBeforeUnmount(() => observer?.disconnect());
  return width;
}
