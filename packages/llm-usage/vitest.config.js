import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'llm-usage', environment: 'node', passWithNoTests: true },
});
