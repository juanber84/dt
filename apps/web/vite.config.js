import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiUrl = env.API_URL ?? 'http://localhost:3000';
  // En producción nginx sirve /docs; en desarrollo, el servidor de VitePress (npm run dev -w
  // @digitaltwin/docs, o el contenedor digitaltwin-docs en Docker local)
  const docsUrl = env.DOCS_URL ?? 'http://localhost:5174';

  return {
    plugins: [vue()],
    // En la raíz: apps/web/node_modules es el punto de montaje del volumen de Docker (de root)
    cacheDir: '../../node_modules/.vite/web',
    server: {
      // 5173 ya está en CORS_ORIGINS de la API, aunque con el proxy no hace falta
      port: 5173,
      strictPort: true,
      // El front llama a rutas relativas (/api/...), igual que cuando se sirva detrás del mismo dominio
      proxy: {
        '/api': apiUrl,
        '/health': apiUrl,
        '/docs': { target: docsUrl, ws: true },
      },
    },
  };
});
