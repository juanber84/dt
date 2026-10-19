import { ref, watchEffect } from 'vue';

const KEY = 'digitaltwin:theme';
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
});

export function useTheme() {
  const isDark = () =>
    theme.value === 'dark' ||
    (theme.value === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  const toggle = () => (theme.value = isDark() ? 'light' : 'dark');
  return { theme, isDark, toggle };
}
