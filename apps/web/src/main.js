import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';
import './styles/tokens.css';
import './styles/base.css';

// Espera a la primera ruta: así /login no enseña un instante la barra lateral
const app = createApp(App).use(router);
router.isReady().then(() => app.mount('#app'));
