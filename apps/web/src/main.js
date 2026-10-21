import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';
import './styles/tokens.css';
import './styles/base.css';

// Espera a la primera ruta: así /login no enseña un instante la barra lateral
const app = createApp(App).use(router);
router.isReady().then(() => app.mount('#app'));

// Service worker solo para los avisos push (sin caché). Al tocar un aviso con la app abierta, el
// service worker pide ir a su pantalla
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'navigate') return;
    const url = new URL(event.data.url);
    if (url.origin === location.origin) router.push(url.pathname + url.search);
  });
}
