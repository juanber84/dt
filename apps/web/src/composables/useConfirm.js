import { ref } from 'vue';

const request = ref(null);

/**
 * Confirmación dentro de la app, en vez del confirm() del navegador. Una a la vez:
 * `await ask({ title, message, confirmLabel, danger })` → true si confirma, false si cancela
 * (Cancelar, Escape o clic fuera). La pinta ConfirmDialog, montado una vez en App.vue.
 */
export function useConfirm() {
  const ask = (options) =>
    new Promise((resolve) => {
      // Si había otra abierta, esa se da por cancelada
      request.value?.resolve(false);
      request.value = { confirmLabel: 'Aceptar', danger: false, ...options, resolve };
    });
  const answer = (ok) => {
    const current = request.value;
    request.value = null;
    current?.resolve(ok);
  };
  return { request, ask, answer };
}
