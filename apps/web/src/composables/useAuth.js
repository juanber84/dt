import { computed, ref } from 'vue';
import { fetchSession, login, logout } from '../services/auth.js';
import { clearTimelineCache } from '../services/twin.js';
import { clearManualEntries } from './useManualEntries.js';

// Usuario de la sesión (la cookie la gestiona el navegador: aquí solo quién es y su rol)
const user = ref(null);
let checked = null;

export function useAuth() {
  return { user, isAdmin: computed(() => user.value?.role === 'admin') };
}

/** Pregunta a la API una sola vez quién soy (la guardia del router lo llama en cada ruta). */
export function ensureSession() {
  checked ??= fetchSession()
    .then(({ user: me }) => (user.value = me))
    .catch(() => (user.value = null));
  return checked;
}

export async function signIn(credentials) {
  const { user: me } = await login(credentials);
  user.value = me;
  checked = Promise.resolve(me);
  return me;
}

export async function signOut() {
  try {
    await logout();
  } finally {
    forgetSession();
  }
}

/** La API ha dicho 401: la sesión ha caducado o se ha cerrado. */
export function forgetSession() {
  user.value = null;
  checked = Promise.resolve(null);
  // Lo que se guardó en memoria era de ese usuario: que no lo vea el siguiente en esta pestaña
  clearTimelineCache();
  clearManualEntries();
}
