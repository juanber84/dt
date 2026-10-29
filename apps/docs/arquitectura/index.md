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

Paquetes compartidos: `engine` (el motor), `timeline` (pipeline y consultas), `queue`, `push`, `coach`, `mcp`, `clinical`, `nutrition`, `strength` (el contrato común de las apps de fuerza, ver abajo), y los clientes de `google-health`, `xiaomi`, `intervals-icu` y `motra`.

### Apps de fuerza

Las plantillas de fuerza del MCP no saben de ninguna app en concreto: hablan con el contrato de `@digitaltwin/strength` (listar, leer, buscar ejercicios, guardar y borrar plantillas, con sus errores: no existe, no es de TwinMe, no caben más, sesión caducada…). Cada app es un **adaptador** que lo cumple y se guarda lo suyo: cómo marca las plantillas de TwinMe, sus límites y su formato. Hoy solo hay uno, el de Motra (`packages/motra/src/strength-app.js`).

No hay catálogo de ejercicios propio: cada app busca en el suyo y sus ids solo valen en ella. La IA elige la app (o le pregunta al usuario si tiene varias) y busca ahí lo que puede usar con su plan.

Para añadir otra (Hevy, la oficial de Motra…): un adaptador que devuelva un `StrengthApp` y una entrada en `providers` de `createStrengthApps` (`apps/api/src/app.js`) que diga si el usuario la tiene conectada. Las herramientas del MCP no cambian.

En la web, las vistas (`views/`) solo juntan piezas: los datos salen de `services/` (llamadas a
la API y funciones puras que las convierten en lo que se pinta, con tests), la lógica con estado
de una pantalla va en `composables/` (p. ej. `useCoachChat`: conversaciones, envío y streaming) y
lo que se pinta, en `components/` por sección. El timeline está en `services/timeline/`: `api.js`
(las llamadas), `days.js` (agrupar por día), `events/` (un fichero por tipo de evento) y
`summary.js` (el resumen y el detalle del día).

Todo corre en contenedores; cada push a `main` pasa tests, lint y formato y se despliega solo.
