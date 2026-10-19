import { ref } from 'vue';

const message = ref(null);
let timer;

/**
 * Aviso breve abajo a la derecha (uno a la vez). `action`: un enlace dentro del aviso
 * ({ label, to } con una ruta), que lo deja más rato a la vista.
 */
export function useToast() {
  const show = (text, tone = 'neutral', { action } = {}) => {
    message.value = { text, tone, action, id: Date.now() };
    clearTimeout(timer);
    timer = setTimeout(() => (message.value = null), action ? 8000 : 4000);
  };
  const hide = () => (message.value = null);
  return { message, show, hide };
}
