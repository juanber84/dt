import { defineConfig } from 'vitepress';

// Documentación de producto de TwinMe. Se sirve en /docs desde el mismo nginx que la web.
// Regla: cada cambio de la plataforma actualiza su página aquí en el mismo commit.
export default defineConfig({
  base: '/docs/',
  lang: 'es-ES',
  title: 'TwinMe',
  description:
    'Tu gemelo digital: sueño, entrenos, nutrición y salud en un sitio, con un motor propio.',
  cleanUrls: false,
  // Sin fecha por página: se construye sin git (el deploy sube el código sin el historial)
  lastUpdated: false,
  appearance: 'dark',
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/docs/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#0f0f0e' }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'TwinMe',
    nav: [
      { text: 'Guía', link: '/guia/empezar' },
      { text: 'El motor', link: '/motor/' },
      { text: 'IA y MCP', link: '/ia/coach' },
      { text: 'API', link: '/api/' },
      { text: 'Novedades', link: '/novedades' },
      { text: 'Abrir la app', link: 'https://twinme.app/', target: '_self' },
    ],
    sidebar: [
      {
        text: 'Empezar',
        items: [
          { text: 'Qué es TwinMe', link: '/' },
          { text: 'Primeros pasos', link: '/guia/empezar' },
          { text: 'Principios', link: '/guia/principios' },
        ],
      },
      {
        text: 'Guía de uso',
        items: [
          { text: 'Hoy', link: '/guia/hoy' },
          { text: 'Registrar', link: '/guia/registrar' },
          { text: 'Tendencias', link: '/guia/tendencias' },
          { text: 'Entrenos', link: '/guia/entrenos' },
          { text: 'Clínica', link: '/guia/clinica' },
          { text: 'Coach', link: '/guia/coach' },
          { text: 'Informes', link: '/guia/informes' },
          { text: 'Bot de Telegram', link: '/guia/telegram' },
          { text: 'La app en el móvil', link: '/guia/movil' },
          { text: 'Ajustes', link: '/guia/ajustes' },
        ],
      },
      {
        text: 'Tus datos',
        items: [
          { text: 'Fuentes y conexiones', link: '/datos/fuentes' },
          { text: 'Cómo se combinan', link: '/datos/combinar' },
          { text: 'Privacidad y seguridad', link: '/datos/privacidad' },
        ],
      },
      {
        text: 'El motor',
        items: [
          { text: 'Visión general', link: '/motor/' },
          { text: 'Peso real', link: '/motor/peso' },
          { text: 'Gasto real', link: '/motor/gasto' },
          { text: 'Objetivos de comida', link: '/motor/objetivos' },
          { text: 'Periodos', link: '/motor/periodos' },
          { text: 'Límites y siguiente', link: '/motor/siguiente' },
          { text: 'Referencias', link: '/motor/referencias' },
        ],
      },
      {
        text: 'IA',
        items: [
          { text: 'El coach', link: '/ia/coach' },
          { text: 'Límite y clave propia', link: '/ia/limites' },
          { text: 'MCP: tu IA con tus datos', link: '/ia/mcp' },
          { text: 'Lectura de informes', link: '/ia/informes' },
        ],
      },
      {
        text: 'API',
        items: [
          { text: 'Introducción', link: '/api/' },
          { text: 'Referencia', link: '/api/referencia' },
          { text: 'Webhooks', link: '/api/webhooks' },
        ],
      },
      {
        text: 'Por dentro',
        items: [
          { text: 'Arquitectura', link: '/arquitectura/' },
          { text: 'Del dato al timeline', link: '/arquitectura/pipeline' },
          { text: 'Trabajos y avisos', link: '/arquitectura/worker' },
          { text: 'Observabilidad', link: '/arquitectura/observabilidad' },
        ],
      },
      { text: 'Novedades', link: '/novedades' },
    ],
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: 'Buscar', buttonAriaLabel: 'Buscar' },
          modal: {
            noResultsText: 'Sin resultados para',
            resetButtonTitle: 'Borrar',
            footer: { selectText: 'abrir', navigateText: 'moverse', closeText: 'cerrar' },
          },
        },
      },
    },
    outline: { level: [2, 3], label: 'En esta página' },
    docFooter: { prev: 'Anterior', next: 'Siguiente' },
    darkModeSwitchLabel: 'Tema',
    sidebarMenuLabel: 'Menú',
    returnToTopLabel: 'Arriba',
    footer: { message: 'TwinMe · tus datos, en tu servidor.' },
  },
});
