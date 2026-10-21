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

Paquetes compartidos: `engine` (el motor), `timeline` (pipeline y consultas), `queue`, `push`, `coach`, `mcp`, `clinical`, `nutrition`, y los clientes de `google-health`, `xiaomi` e `intervals-icu`.

Todo corre en contenedores; cada push a `main` pasa tests, lint y formato y se despliega solo.
