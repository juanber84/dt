import { onBeforeUnmount, onMounted, ref } from 'vue';

/** Ancho en px de un elemento, actualizado al redimensionar (las gráficas dibujan en px reales). */
export function useElementWidth(el, fallback = 300) {
  const width = ref(fallback);
  let observer;
  onMounted(() => {
    if (!el.value) return;
    width.value = el.value.clientWidth || fallback;
    if (typeof ResizeObserver === 'undefined') return;
    observer = new ResizeObserver(([entry]) => {
      width.value = Math.max(0, Math.floor(entry.contentRect.width));
    });
    observer.observe(el.value);
  });
  onBeforeUnmount(() => observer?.disconnect());
  return width;
}
