# Observabilidad

Lo que pasa en producción se ve en **Grafana Cloud** (plan gratis), no en nuestra base de datos: el dashboard [TwinMe · Estado](https://juanber84.grafana.net/d/twinme-status) y las alertas por correo.

```
             fuera                                 VPS
┌──────────────────────────┐    ┌───────────────────────────────────────────────┐
│ Synthetic Monitoring     │    │ digitaltwin-api ──/metrics──┐                 │
│ (España, París,          │──▶ │   │  ▲                      │                 │
│  Frankfurt)              │    │   │  └─ trazas ─────────┐   ▼                 │
│ twinme.app/…/ready  2min │    │   ▼                     ├─▶ digitaltwin-alloy ─┼─▶ Grafana Cloud
│ twinme.app/         5min │    │ cola ─▶ digitaltwin-worker ┘  ▲  ▲             │   (métricas,
└──────────────────────────┘    │ digitaltwin-bot ─ trazas ────┘  │             │    logs, trazas,
                                │ servidor y contenedores ────────┤             │    alertas)
                                │ logs de Docker ─────────────────┘             │
                                └───────────────────────────────────────────────┘
```

## Qué se recoge

| Qué                        | De dónde                                      | Cómo                                                                                                                                                                                                                           |
| -------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **¿Funciona desde fuera?** | Grafana Synthetic Monitoring                  | `GET https://twinme.app/api/v1/health/ready` cada 2 min desde 3 sondas (tiene que dar 200 y `"status":"ok"`, que solo sale si la API llega a la BD); la web cada 5 min desde 2. Pasa por Cloudflare y el túnel, como la gente. |
| **Métricas de la app**     | `GET /metrics` de la API (formato Prometheus) | Peticiones por ruta y código, con su duración; colas de pg-boss; latido del worker y del bot; trabajos hechos, reintentados, fallidos y aplazados; última copia de seguridad; memoria y event loop de Node.                    |
| **Servidor**               | `digitaltwin-alloy`                           | CPU, RAM, disco, carga y red del VPS.                                                                                                                                                                                          |
| **Contenedores**           | `digitaltwin-alloy` (cAdvisor)                | CPU, memoria y OOM de cada `digitaltwin-*`. Los de otros proyectos del VPS no se miran.                                                                                                                                        |
| **Logs**                   | `digitaltwin-alloy` (socket de Docker)        | Todo lo que escriben los `digitaltwin-*`, sin las comprobaciones de salud; de Alloy, solo sus avisos y errores. Los de API, worker y bot llevan el nivel como etiqueta (`level`) y, dentro de una traza, `trace_id`.           |
| **Trazas**                 | OpenTelemetry (`packages/telemetry`)          | Cada petición a la API, cada mensaje al bot y cada trabajo del worker, con las llamadas que hacen fuera (Google, DeepSeek, intervals.icu, Telegram…).                                                                          |

`/metrics` no se ve desde fuera: nginx solo reenvía `/api` y `/webhooks`, así que solo lo lee Alloy por la red de Docker. No lleva datos de salud ni ids de usuario: solo cuánto, cuánto tarda y si va bien.

## Trazas

Cada servicio arranca con `node --import @digitaltwin/telemetry/register .` (lo pone `docker/digitaltwin-run.sh`). Sin `OTEL_EXPORTER_OTLP_ENDPOINT` no hace nada; en producción apunta a `digitaltwin-alloy:4318`.

- **La traza sigue por la cola.** Al encolar, `@digitaltwin/queue` guarda la traza activa en `data._trace` (`traceparent`) y el worker abre el span `job <cola>` como hijo. Un mensaje al bot que acaba en la API, encola un `normalize` y lo procesa el worker es una sola traza.
- **Sin ruido.** Las consultas de pg (las de pg-boss) y las llamadas `fetch` solo se miden dentro de una traza, así que el sondeo de Telegram y de pg-boss no crean trazas solas. `/health` y `/metrics` tampoco.
- **Lo que no sale:** las consultas de `postgres.js` (el cliente del resto de la app) no tienen instrumentación.
- **Ayudas** (`@digitaltwin/telemetry`): `withSpan(nombre, opciones, fn)` para medir un trozo de código y `withJobSpan(cola, trabajo, fn)` en el worker. Sin el SDK arrancado no hacen nada, así que valen en los tests.

## Alertas

Llegan por correo. Están en `scripts/grafana/alerts.js` y llevan la etiqueta `project=twinme`.

| Alerta                             | Cuándo                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| TwinMe caída desde fuera           | La mitad de las sondas fallan durante 6 min (o no hay datos de las sondas)        |
| Frontal caído desde fuera          | `https://twinme.app/` no devuelve la web durante 15 min                           |
| No llegan métricas del VPS         | Alloy no manda nada desde hace 10 min (avisa una vez por todas las internas)      |
| La API no responde dentro del VPS  | Alloy no puede leer `/metrics` durante 3 min                                      |
| El worker no late · El bot no late | Tres latidos perdidos durante 5 min · 10 min                                      |
| Errores 5xx en la API              | Más de 5 en 15 min                                                                |
| Trabajos del worker fallando       | Más de 3 fallidos en 30 min en una cola (fallido = agotó sus reintentos)          |
| Cola atascada                      | Más de 50 esperando durante 30 min (sin contar `fetch`, `backfill` y `normalize`) |
| Sin copia de seguridad reciente    | La última buena es de hace más de 26 h, o la última falló                         |
| Muchos errores en los logs         | Más de 10 líneas de error en 15 min                                               |
| Disco · memoria · OOM              | Disco > 90 %, RAM disponible < 5 %, un contenedor sin memoria                     |
| Certificado                        | Caduca en menos de 14 días                                                        |

## Montarlo o cambiarlo

Todo lo de Grafana (comprobaciones, alertas, correo, dashboard y el token de Alloy) se monta con un script que se puede repetir: actualiza en vez de duplicar. Para cambiar una alerta o el dashboard, se edita `scripts/grafana/` y se vuelve a lanzar. Cómo se prepara la primera vez: `INSTALL.md`, sección 7.

```bash
make grafana
```

Límites del plan gratis: 10k series de métricas, 50 GB de logs, 50 GB de trazas (14 días) y 100k ejecuciones de comprobaciones al mes. Las métricas pasan por listas de las que se guardan (`docker/alloy/config.alloy`), y las comprobaciones gastan unas 82k al mes.

**Avisos que no son fallos:** en cada arranque del worker se vuelve a registrar el suscriptor de Google, y Google prueba el webhook dos veces: con el secreto (`google-health webhook verificado`) y sin él, para ver que se rechaza. Ese rechazo sale como `info`; solo es `warn` si llega una cabecera `Authorization` que no casa.
