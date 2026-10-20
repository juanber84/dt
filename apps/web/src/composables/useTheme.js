import { ref, watchEffect } from 'vue';

const KEY = 'digitaltwin:theme';
// --page de tokens.css en cada tema
const THEME_COLORS = { light: '#f4f4f1', dark: '#0f0f0e' };
// 'system' sigue al sistema; 'light'/'dark' lo fijan (data-theme en <html>)
// ?theme=dark|light|system en la URL lo fija (útil para capturas y enlaces)
const fromUrl = new URLSearchParams(location.search).get('theme');
const theme = ref(
  ['light', 'dark', 'system'].includes(fromUrl) ? fromUrl : (localStorage.getItem(KEY) ?? 'system'),
);

watchEffect(() => {
  const root = document.documentElement;
  if (theme.value === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme.value);
  localStorage.setItem(KEY, theme.value);
  // Color de la barra del navegador / app instalada (index.html trae uno por esquema del sistema)
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.dataset.scheme ??= meta.media.includes('dark') ? 'dark' : 'light';
    meta.content =
      THEME_COLORS[theme.value === 'system' ? meta.dataset.scheme : theme.value] ?? meta.content;
  }
});

export function useTheme() {
  const isDark = () =>
    theme.value === 'dark' ||
    (theme.value === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  const toggle = () => (theme.value = isDark() ? 'light' : 'dark');
  return { theme, isDark, toggle };
}
