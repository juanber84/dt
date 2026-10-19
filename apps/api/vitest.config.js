import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api',
    environment: 'node',
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
  },
});
