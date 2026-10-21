import js from '@eslint/js';
import globals from 'globals';
import vue from 'eslint-plugin-vue';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['**/node_modules/**', '**/coverage/**', '**/dist/**', '**/.vitepress/cache/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // Frontal: Vue 3 en el navegador
  ...vue.configs['flat/recommended'].map((config) => ({ ...config, files: ['apps/web/**'] })),
  {
    files: ['apps/web/src/**'],
    languageOptions: { globals: { ...globals.browser } },
  },
  // El service worker de los avisos push
  {
    files: ['apps/web/public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  prettier,
];
