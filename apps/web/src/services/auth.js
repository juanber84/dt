/**
 * Sesión del front. La API pondrá una cookie de sesión (HttpOnly) al entrar: el front no ve ni
 * guarda ningún token.
 */
import { apiFetch } from '../api.js';

/** @param {{ username: string, password: string, remember: boolean }} credentials */
export const login = (credentials) =>
  apiFetch('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(credentials) });

export const logout = () => apiFetch('/api/v1/auth/logout', { method: 'POST' });

/** Quién soy (o 401 si no hay sesión). */
export const fetchSession = () => apiFetch('/api/v1/auth/session');

// --- Passkeys (Face ID / Touch ID) ---------------------------------------------------------------

const post = (path, body) =>
  apiFetch(path, { method: 'POST', ...(body && { body: JSON.stringify(body) }) });

// Este dispositivo ya tiene passkey: el login pone Face ID primero (solo es una preferencia local)
const HAS_PASSKEY = 'digitaltwin:passkey';
export function passkeyHere() {
  try {
    return localStorage.getItem(HAS_PASSKEY) === '1';
  } catch {
    return false;
  }
}
function rememberPasskeyHere() {
  try {
    localStorage.setItem(HAS_PASSKEY, '1');
  } catch {
    // Sin almacenamiento: el botón sale debajo, sin más
  }
}

/** Entrar con una passkey: el dispositivo pide la cara o la huella y firma el reto de la API. */
export async function loginWithPasskey() {
  const { startAuthentication } = await import('@simplewebauthn/browser');
  const optionsJSON = await post('/api/v1/auth/passkey/options');
  const response = await startAuthentication({ optionsJSON });
  const result = await post('/api/v1/auth/passkey', { response });
  rememberPasskeyHere();
  return result;
}

export const listPasskeys = () => apiFetch('/api/v1/passkeys').then((r) => r.items);

/** Da de alta este dispositivo (con la sesión abierta). */
export async function addPasskey(name) {
  const { startRegistration } = await import('@simplewebauthn/browser');
  const optionsJSON = await post('/api/v1/passkeys/options');
  const response = await startRegistration({ optionsJSON });
  const result = await post('/api/v1/passkeys', { response, name });
  rememberPasskeyHere();
  return result;
}

export const deletePasskey = (id) =>
  apiFetch(`/api/v1/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Nombre por defecto de la passkey de este dispositivo. */
export function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Este dispositivo';
}

/** Si el navegador sabe hacer passkeys (Safari, Chrome... con HTTPS o localhost). */
export const supportsPasskeys = () =>
  typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';

/** El dispositivo canceló (o el usuario cerró el diálogo de Face ID): no es un error que enseñar. */
export const cancelled = (err) => err?.name === 'NotAllowedError' || err?.name === 'AbortError';
