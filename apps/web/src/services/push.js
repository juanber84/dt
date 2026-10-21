/**
 * Avisos push en este dispositivo: permiso, suscripción (pushManager) y lo que guarda la API.
 */
import { apiFetch } from '../api.js';
import { deviceName } from './auth.js';

export const fetchPush = () => apiFetch('/api/v1/push');

export const savePushSettings = (patch) =>
  apiFetch('/api/v1/push/settings', { method: 'PUT', body: JSON.stringify(patch) });

export const sendTestPush = () => apiFetch('/api/v1/push/test', { method: 'POST' });

const isIos = () =>
  /iPhone|iPad/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const isInstalled = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

/**
 * Qué se puede hacer aquí:
 *   unsupported   el navegador no sabe (o es Safari del iPhone sin instalar la app: 'install')
 *   install       iPhone/iPad: solo con la app añadida a la pantalla de inicio
 *   denied        se bloquearon en los ajustes del sistema
 *   off / on      se pueden activar / ya están activadas en este dispositivo
 */
export async function pushState() {
  const supported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) return isIos() && !isInstalled() ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription && Notification.permission === 'granted' ? 'on' : 'off';
}

/** La endpoint de este dispositivo (para marcarlo en la lista), si está suscrito. */
export async function currentEndpoint() {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.ready;
  return (await registration.pushManager.getSubscription())?.endpoint ?? null;
}

const base64ToBytes = (base64) => {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

/** Pide permiso (tiene que ser tras un toque) y apunta este dispositivo en la API. */
export async function enablePush(publicKey) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission;
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToBytes(publicKey),
    }));
  await apiFetch('/api/v1/push/subscriptions', {
    method: 'POST',
    body: JSON.stringify({ subscription: subscription.toJSON(), device: deviceName() }),
  });
  return 'granted';
}

/** Quita un dispositivo de la lista (desde cualquier otro): deja de recibir avisos. */
export const removeDevice = (endpoint) =>
  apiFetch('/api/v1/push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint }) });

/** Deja de recibir avisos en este dispositivo. */
export async function disablePush() {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await apiFetch('/api/v1/push/subscriptions', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
}

/** Número en el icono de la app (iOS 16.4+ instalada). Sin soporte, no hace nada. */
export function setBadge(count) {
  try {
    if (count > 0) navigator.setAppBadge?.(count)?.catch?.(() => {});
    else navigator.clearAppBadge?.()?.catch?.(() => {});
  } catch {
    // Sin soporte
  }
}
