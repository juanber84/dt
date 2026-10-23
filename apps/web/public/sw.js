/*
 * Service worker de TwinMe: SOLO para los avisos push. No tiene `fetch`, así que no guarda
 * nada en caché ni se mete entre la app y la red: cada deploy se ve al momento.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Llega un aviso: { title, body, url, tag, badge? }
self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { title: 'TwinMe', body: event.data?.text() ?? '' };
  }
  const shown = self.registration.showNotification(data.title ?? 'TwinMe', {
    body: data.body ?? '',
    tag: data.tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url ?? '/' },
  });
  // Número en el icono de la app (iOS 16.4+ con la app instalada, Chrome/Edge en escritorio)
  const badge =
    typeof data.badge === 'number' && self.navigator.setAppBadge
      ? data.badge > 0
        ? self.navigator.setAppBadge(data.badge)
        : self.navigator.clearAppBadge()
      : Promise.resolve();
  event.waitUntil(Promise.all([shown, badge.catch(() => {})]));
});

// Al tocarlo: la app en la pantalla del aviso (si ya estaba abierta, se lleva ahí)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => w.url.startsWith(self.location.origin));
      if (open) {
        await open.focus();
        open.postMessage({ type: 'navigate', url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
