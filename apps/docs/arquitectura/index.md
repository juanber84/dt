# Arquitectura

```
                 ┌──────────── nginx (web + /docs) ────────────┐
 navegador ─────►│  app Vue (PWA)        /api ─► API (Express) │
 (PWA, iPhone)   └──────────────────────────────┬──────────────┘
                                                │
 Telegram ─► bot (grammY) ─► API                │
 Google ─► webhook ─► API ──► cola (pg-boss) ──► worker
                                                │
                    PostgreSQL 18 + TimescaleDB ◄┘
```

| Pieza      | Qué hace                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| **web**    | Vue 3 + Vite. PWA instalable, sin caché (el service worker solo es para notificaciones)                                   |
| **api**    | Express 5: sesiones, datos, motor, coach (streaming), MCP, webhooks                                                       |
| **worker** | Sincronizaciones, cargas iniciales, normalización, lectura de informes, avisos, suscriptor de Google, copias de seguridad |
| **bot**    | Telegram (grammY): comidas, agua y medicación                                                                             |
| **db**     | PostgreSQL 18 con TimescaleDB: series por hora en agregados continuos                                                     |
| **docs**   | Esta documentación (VitePress)                                                                                            |

Paquetes compartidos: `engine` (el motor), `timeline` (pipeline y consultas), `queue`, `push`, `coach`, `mcp`, `clinical`, `nutrition`, y los clientes de `google-health`, `xiaomi`, `intervals-icu` y `motra`.

En la web, las vistas (`views/`) solo juntan piezas: los datos salen de `services/` (llamadas a
la API y funciones puras que las convierten en lo que se pinta, con tests), la lógica con estado
de una pantalla va en `composables/` (p. ej. `useCoachChat`: conversaciones, envío y streaming) y
lo que se pinta, en `components/` por sección. El timeline está en `services/timeline/`: `api.js`
(las llamadas), `days.js` (agrupar por día), `events/` (un fichero por tipo de evento) y
`summary.js` (el resumen y el detalle del día).

Todo corre en contenedores; cada push a `main` pasa tests, lint y formato y se despliega solo.
