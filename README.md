# Digital Twin

Monorepo (npm workspaces) con la API REST y las librerías compartidas.

```
digitaltwin/
├── apps/
│   ├── api/                 # API REST Express (@digitaltwin/api)
│   ├── bot/                 # Bot de Telegram para registrar comidas (@digitaltwin/bot)
│   ├── web/                 # Frontal Vue 3 para conectar cuentas de terceros (@digitaltwin/web)
│   └── worker/              # Cola: sincronizaciones, backfills, normalización, cron (@digitaltwin/worker)
├── packages/
│   ├── clinical/            # Informes médicos en PDF: texto, datos personales fuera, LLM, revisión (@digitaltwin/clinical)
│   ├── coach/               # El coach: agente LLM con herramientas sobre los datos (@digitaltwin/coach)
│   ├── connections/         # Conexiones con proveedores, credenciales cifradas (@digitaltwin/connections)
│   ├── db/                  # PostgreSQL + TimescaleDB: cliente y migraciones (@digitaltwin/db)
│   ├── llm-usage/           # Cuenta del gasto en LLM: precios, coste y filas de llm_usage (@digitaltwin/llm-usage)
│   ├── logger/              # Logger compartido (@digitaltwin/logger)
│   ├── nutrition/           # Macros con LLM (DeepSeek/OpenAI) + esquemas (@digitaltwin/nutrition)
│   ├── queue/               # Cola sobre Postgres (pg-boss) y nombres de los trabajos (@digitaltwin/queue)
│   └── timeline/            # Timeline normalizado: catálogo, normalizadores, consultas (@digitaltwin/timeline)
└── scripts/
    └── new-lib.js           # Generador de librerías
```

- `apps/*`: aplicaciones desplegables (API, y en el futuro workers/procesos independientes).
- `packages/*`: librerías unitarias y testeadas, reutilizables desde la API o desde cualquier proceso.

## Requisitos

Node.js >= 22 (`nvm use`).

## Puesta en marcha

Guía completa (API + bot, local y producción): **[INSTALL.md](INSTALL.md)**.

```bash
npm install
cp apps/api/.env.example apps/api/.env   # ya creado la primera vez
npm run dev                              # API con recarga en http://localhost:3000
```

## Makefile

`make` muestra todos los comandos. Los principales: `make setup`, `make up` (API + bot + frontal), `make web`,
`make dev`, `make test`,
`make check` (lint + formato + tests) y `make new-lib name=<nombre>`.

## Scripts

| Script                  | Descripción                                 |
| ----------------------- | ------------------------------------------- |
| `npm run dev`           | Arranca la API en modo watch                |
| `npm start`             | Arranca la API                              |
| `npm test`              | Tests de todos los workspaces (Vitest)      |
| `npm run test:coverage` | Tests con cobertura                         |
| `npm run lint`          | ESLint                                      |
| `npm run format`        | Prettier                                    |
| `npm run new:lib <n>`   | Crea `packages/<n>` como `@digitaltwin/<n>` |

Tests de un solo workspace: `npm test -w @digitaltwin/logger`.

## API

Incluye: Express 5, CORS configurable por entorno, Helmet, compresión, rate limiting en `/api`,
logging estructurado con request id (`X-Request-Id`), validación de entrada con Zod,
manejo de errores uniforme, validación de configuración y cierre ordenado (SIGTERM/SIGINT).

Endpoints:

- `GET /health` – liveness (sin rate limit)
- `GET /api/v1/health/ready` – readiness con uptime y versión
- `POST /api/v1/nutrition/analyze` – estima platos, ingredientes, hora y macros de un texto/foto
  con el LLM (`LLM_*`: DeepSeek por defecto, cualquier API compatible con OpenAI)
- `POST /api/v1/nutrition/refine` – rehace la estimación con una corrección
- `POST /api/v1/nutrition/entries` – comida confirmada (antiguo: solo se registra en el log; el
  bot usa `/webhooks/digitaltwin`)
- `POST /api/v1/connections/:provider/sync` – encola una sincronización (202)
- `GET /api/v1/timeline/metrics|series|episodes|observations` – el timeline normalizado
- `GET|DELETE /api/v1/coach/conversations[/:id]` y `POST /api/v1/coach/messages` – el coach (IA
  con las herramientas del MCP, sin pasar por la red); la respuesta va en streaming SSE.
  `COACH_LLM_*` (por defecto, el mismo LLM que `LLM_*`) y BD
- `GET|POST /api/v1/clinical/documents`, `GET|PUT|DELETE /api/v1/clinical/documents/:id`,
  `POST .../confirm|retry`, `GET /api/v1/clinical/parameters|metrics` – informes médicos (Clínica):
  se sube el PDF (`application/pdf`, hasta `CLINICAL_UPLOAD_LIMIT`), el worker lo lee con
  `pdftotext` + `LLM_*` (sin datos personales), se revisa y al confirmar va al timeline
- `GET /api/v1/admin/ai` – solo admin: modelos, saldo de DeepSeek y gasto apuntado por llamada
  (tabla `llm_usage`, coste estimado con `LLM_PRICES`)

Webhooks (fuera de `/api`, cada uno con su verificación):

- `POST /webhooks/google-health` – avisos de Google: se descarga el día afectado
- `POST /webhooks/digitaltwin` – eventos del bot (`meal.logged`, `sync.requested`), firmados con
  HMAC (`DIGITALTWIN_WEBHOOK_SECRET`, cabecera `X-Digitaltwin-Signature: t=<unix>,v1=<hex>`)

## Pipeline de datos

```
entradas                         buzón (inbox)            cola (pg-boss)        worker
webhook Google (aviso)    ─┐                          ┌─ sync / backfill ─▶ descarga por trozos
webhook bot (comida)      ─┼─▶ se apunta tal cual ────┼─ fetch            ─▶ raw_records (tal cual)
cron / botón / /sincroniza─┘                          └─ normalize        ─▶ observations + episodes
```

- **raw_records**: lo que dijo cada fuente, intacto y por lote (Google: un registro por tipo y día).
  `source` + `external_id` hacen que re-importar no duplique; se puede re-normalizar sin volver a
  descargar.
- **observations**: hypertable estrecha (tiempo, usuario, métrica, stream, valor), comprimida a
  los 30 días, con un agregado continuo por hora (`observations_hourly`).
- **episodes**: comidas, entrenos, sueño, pesajes... con resumen y su extensión (`schema`
  versionado, p. ej. `meal@1`).
- **Valor canónico**: en cada hora manda el proveedor con mejor prioridad (`source_priorities`) y
  dentro de él el stream más completo; el día se agrega desde esas horas.

Autenticación: todo `/api/v1` salvo `/api/v1/health` exige `Authorization: Bearer <clave>` con
una de `DIGITALTWIN_API_KEYS` (`nombre:clave` por cliente, separadas por coma; el nombre sale en
los logs). Los webhooks de terceros van fuera, en `/webhooks/<proveedor>`, cada uno con la
verificación de su proveedor.

Formato de error:

```json
{ "error": { "code": "NOT_FOUND", "message": "...", "requestId": "..." } }
```

Añadir un recurso: crea `src/routes/<x>.routes.js` + `src/controllers/<x>.controller.js` y
móntalo en `src/routes/index.js`. Usa `validate({ body, query, params })` con esquemas Zod y
lanza `HttpError.notFound()` etc. desde los controladores (Express 5 captura errores async).

## Librerías

```bash
npm run new:lib sensors
npm install
npm install @digitaltwin/sensors -w @digitaltwin/api
```

```js
import { hello } from '@digitaltwin/sensors';
```

## Despliegue (VPS)

Push a `main` → GitHub Actions → SSH al VPS → `docker compose up -d --build` (las imágenes se
construyen en el VPS; nada se guarda en registros ni artefactos). Secretos en Infisical.

Todo el detalle (local, preparación del VPS, Infisical, secrets de GitHub, operación y problemas
frecuentes) en **[INSTALL.md](INSTALL.md)**.
