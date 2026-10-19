import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'queue', environment: 'node' },
});
