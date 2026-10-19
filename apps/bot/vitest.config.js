import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'bot',
    environment: 'node',
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
  },
});
