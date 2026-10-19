import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

export default defineConfig((env) =>
  mergeConfig(viteConfig(env), {
    test: {
      name: 'web',
      environment: 'happy-dom',
    },
  }),
);
