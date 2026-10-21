# Instalación y despliegue

Guía para poner en marcha Digital Twin (web + API + worker + bot de Telegram) en local y en el VPS.

```
Navegador ⇄ digitaltwin-web (nginx: el front y /api) ──▶ digitaltwin-api
Telegram ⇄ digitaltwin-bot ──webhook firmado──▶ digitaltwin-api ──▶ LLM (DeepSeek)
Google / webhooks ───────────────────────────────▶      │ encola
                                                         ▼
Xiaomi, Google ◀── digitaltwin-worker ◀── cola (pg-boss) en digitaltwin-db (TimescaleDB)
```

- **API** (`apps/api`): estima macros con el LLM, recibe webhooks (bot, Google) y sirve el
  timeline. No descarga nada: lo encola.
- **Worker** (`apps/worker`): sincronizaciones, cargas iniciales por trozos, normalización, cron y
  lectura de los informes médicos (PDF → texto con `pdftotext` → LLM).
- **Web** (`apps/web`): Vue compilado y servido por nginx, que reenvía `/api` a la API.
- **Bot** (`apps/bot`): solo interfaz. Long polling, no necesita webhook ni puertos abiertos.

## Índice

1. [Local](#1-local)
2. [Producción: cómo funciona](#2-producción-cómo-funciona)
3. [Producción: preparación (una sola vez)](#3-producción-preparación-una-sola-vez)
4. [Primer despliegue](#4-primer-despliegue)
5. [Día a día](#5-día-a-día)
6. [Copias de seguridad](#6-copias-de-seguridad)
7. [Problemas frecuentes](#7-problemas-frecuentes)

---

## 1. Local

Requisitos: Node.js >= 22 (`nvm use`).

```bash
npm install
make env bot-env          # crea apps/api/.env y apps/bot/.env a partir de los .env.example
```

### apps/api/.env

| Variable               | Valor                                                      |
| ---------------------- | ---------------------------------------------------------- |
| `DIGITALTWIN_API_KEYS` | `bot:<clave>` (genera la clave con `openssl rand -hex 32`) |
| `LLM_API_KEY`          | clave de DeepSeek                                          |
| `TIMEZONE`             | `Europe/Madrid`                                            |

El resto tiene valores por defecto válidos (ver comentarios en `apps/api/.env.example`).

### apps/bot/.env

| Variable                    | Valor                                                     |
| --------------------------- | --------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`        | token del bot de **desarrollo** (ver aviso abajo)         |
| `TELEGRAM_ALLOWED_USER_IDS` | vacío la primera vez (ver abajo)                          |
| `DIGITALTWIN_API_KEY`       | la misma `<clave>` que pusiste en `bot:<clave>` en la API |
| `API_URL`                   | `http://localhost:3000`                                   |

### Arrancar

```bash
make up                   # API + bot a la vez (Ctrl+C para los dos)
```

**Tu ID de Telegram:** con `TELEGRAM_ALLOWED_USER_IDS` vacío el bot arranca en modo
configuración y a quien le escriba le contesta solo con su ID. Ponlo en el `.env` y reinicia.
A partir de ahí solo responde a esos IDs.

> ⚠️ **Un token, un bot.** Telegram solo deja a una instancia leer los mensajes de un bot
> (long polling). Si el bot del VPS y el local usan el mismo token, chocan (error 409). Crea un
> segundo bot en @BotFather (p. ej. `digital_twin_dev_bot`) para desarrollo.

### Documentación

La documentación de producto (`apps/docs`, VitePress) se sirve en `/docs`. En local: `make docs`
(http://localhost:5174/docs/); con `make web` o en Docker local, Vite la reenvía y se ve en
`/docs/` igual que en producción. Cada cambio de la plataforma actualiza su página en el mismo
commit.

### Probar en Docker como en el VPS

`make docker-up` levanta **el mismo `docker-compose.prod.yml` que producción**: mismas imágenes,
y los secretos se piden a Infisical desde dentro de los contenedores. Cambia solo el entorno de
Infisical (`dev` por defecto), la red (`digitaltwin-local` en vez de `red-n8n`) que la API se
publica en `http://localhost:3080` y el frontal en `http://localhost:3081`.

```bash
make docker-up      # la primera vez crea .env.infisical: rellénalo y vuelve a lanzarlo
make docker-down    # para y borra los contenedores
```

`.env.infisical` (en `.gitignore`):

| Variable                                          | Valor                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| `INFISICAL_DOMAIN`                                | URL de tu Infisical, sin `/api` (p. ej. `https://app.infisical.com`) |
| `INFISICAL_PROJECT_ID`                            | ID del proyecto (en _Project Settings_)                              |
| `INFISICAL_ENV`                                   | `dev` (o `staging`, `prod`)                                          |
| `INFISICAL_TOKEN`                                 | token de acceso, **o bien**...                                       |
| `INFISICAL_CLIENT_ID` + `INFISICAL_CLIENT_SECRET` | ...una machine identity (universal auth)                             |

Comprobar la API: `curl localhost:3080/health`.

> ⚠️ Para `make up` antes: si los secretos de `dev` llevan el mismo `TELEGRAM_BOT_TOKEN`, los dos
> bots chocan (409).

---

## 2. Producción: cómo funciona

Cada push a `main` (o lanzándolo a mano desde Actions) ejecuta `.github/workflows/deploy.yml`.
Un único job:

1. Comprueba que estén los secrets del repo (apartado 3.3); si falta alguno dice cuál.
2. `npm ci`, lint, formato (Prettier) y tests. Si fallan, no se despliega.
3. `git archive` del código a un tar en `/tmp` del runner (no es un artefacto: se borra con el runner).
4. `scp` del tar al VPS.
5. Por SSH en el VPS:
   - descomprime en `/opt/digitaltwin/app/` (reemplaza la versión anterior);
   - exporta `INFISICAL_DOMAIN`, `INFISICAL_PROJECT_ID`, el acceso (token o machine identity) y
     `DIGITALTWIN_DB_PASSWORD`;
   - `sudo -E docker compose -f docker-compose.prod.yml up -d --build --remove-orphans`;
   - `docker image prune -f` y limpia la caché de build de más de una semana.

**No se guarda nada fuera del VPS:** ni imágenes en GHCR/Docker Hub ni artefactos en GitHub. Las
imágenes se construyen en el propio VPS.

**Contenedores** (`docker-compose.prod.yml`), todos con prefijo `digitaltwin` para no chocar con
otros proyectos de la red:

| Contenedor           | Qué hace                                                               |
| -------------------- | ---------------------------------------------------------------------- |
| `digitaltwin-db`     | TimescaleDB; los datos en el volumen `digitaltwin-db-data`             |
| `digitaltwin-api`    | API en el puerto 3000; aplica las migraciones al arrancar              |
| `digitaltwin-worker` | Cola, sincronizaciones, cron e informes; arranca con la API sana       |
| `digitaltwin-bot`    | Bot; arranca cuando la API está sana                                   |
| `digitaltwin-web`    | nginx en el puerto 80: el front y `/api` reenviado a `digitaltwin-api` |

Todos en la red `red-n8n`. El bot habla con la API por `http://digitaltwin-api:3000` (red interna
de Docker). Ninguno publica puertos en el VPS: se llega por cloudflared (apartado 3.4).

**Secretos:** viven en **Infisical**. Cada contenedor arranca con `digitaltwin-run /api|/bot`
(`docker/digitaltwin-run.sh`): se autentica (token o machine identity) y ejecuta
`infisical run --path=/api|/bot --watch -- node .`, así que los secretos no están ni en el repo,
ni en la imagen, ni en ficheros del VPS. Con `--watch`, si cambias un secreto en Infisical el
proceso se reinicia solo.

---

## 3. Producción: preparación (una sola vez)

### 3.1 VPS

- Docker con el plugin `compose`, y el usuario de SSH con `sudo` para docker.
- La red externa `red-n8n` (ya existe si tienes otros proyectos en ella):

  ```bash
  sudo docker network create red-n8n   # solo si no existe
  ```

### 3.2 Infisical

Crea el proyecto **digitaltwin** con el entorno **`prod`** y dos carpetas:

**`/api`**

| Secreto                                     | Valor                                                                                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `DIGITALTWIN_API_KEYS`                      | `bot:<clave>` — clave **nueva** de producción (`openssl rand -hex 32`)                                                             |
| `LLM_API_KEY`                               | clave de DeepSeek                                                                                                                  |
| `TIMEZONE`                                  | `Europe/Madrid`                                                                                                                    |
| `TRUST_PROXY`                               | `2` detrás de cloudflared + nginx (uno por proxy)                                                                                  |
| `TOKEN_ENCRYPTION_KEY`                      | `openssl rand -hex 32` (cifra las credenciales de las conexiones)                                                                  |
| `JWT_SECRET`                                | `openssl rand -hex 32` (sesiones de la web; sin él se pierden al reiniciar)                                                        |
| `DIGITALTWIN_WEBHOOK_SECRET`                | `openssl rand -hex 32` (firma de los eventos del bot; **también en `/bot`**)                                                       |
| `PUBLIC_URL`                                | URL pública del front (p. ej. `https://twin.tudominio.com`); por defecto `http://localhost:3081`, que en producción rompe el OAuth |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | cliente OAuth de Google; da de alta `<PUBLIC_URL>/api/v1/connections/google-health/callback`                                       |

Opcionales: `LLM_BASE_URL` y `LLM_MODEL` (para cambiar de proveedor), `COACH_LLM_*`, `LOG_LEVEL`,
`CORS_ORIGINS`, `GOOGLE_HEALTH_WEBHOOK_SECRET`, `CLINICAL_UPLOAD_LIMIT` (15mb; nginx deja hasta
16m)... (ver `apps/api/.env.example`).

El **worker usa también `/api`** (descifra las mismas conexiones y lee los informes de Clínica con
`LLM_API_KEY`: sin ella los PDF quedan en error). Sus ajustes opcionales, con
valores por defecto: `XIAOMI_SYNC_CRON` (`*/30 * * * *`), `GOOGLE_SYNC_CRON` (`0 * * * *`),
`GOOGLE_BACKFILL_DAYS` (730), `GOOGLE_BACKFILL_CHUNK_DAYS` (30), `GOOGLE_REQUESTS_PER_MINUTE`
(120), `XIAOMI_REQUESTS_PER_MINUTE` (10) y los `INTERVALS_*` equivalentes para intervals.icu.

**`/bot`**

| Secreto                      | Valor                                         |
| ---------------------------- | --------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`         | token del bot de **producción**               |
| `TELEGRAM_ALLOWED_USER_IDS`  | tu ID de Telegram (varios separados por coma) |
| `DIGITALTWIN_API_KEY`        | la misma `<clave>` de `bot:<clave>` en `/api` |
| `DIGITALTWIN_WEBHOOK_SECRET` | el mismo que en `/api`                        |
| `TIMEZONE`                   | `Europe/Madrid`                               |

`API_URL` y `NODE_ENV` no hace falta ponerlos: los fija el compose.

Acceso para los contenedores, una de las dos:

- **Service token** (como cadenceai), con lectura en `prod` → `INFISICAL_TOKEN`.
- **Machine identity** con _Universal Auth_, añadida al proyecto con lectura →
  `INFISICAL_CLIENT_ID` + `INFISICAL_CLIENT_SECRET`. El contenedor hace login en cada arranque,
  así que no hay que renovar nada a mano.

### 3.3 Secrets del repo en GitHub

En _Settings → Secrets and variables → Actions_ del repo `juanber84/dt`:

| Secret                    | Valor                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `VPS_HOST`                | host del VPS                                                                         |
| `VPS_USERNAME`            | usuario de SSH                                                                       |
| `VPS_SSH_KEY`             | clave privada SSH (la misma que en cadenceai sirve)                                  |
| `INFISICAL_TOKEN`         | service token (o deja este vacío y usa los dos de abajo)                             |
| `INFISICAL_CLIENT_ID`     | machine identity: Client ID                                                          |
| `INFISICAL_CLIENT_SECRET` | machine identity: Client Secret                                                      |
| `INFISICAL_DOMAIN`        | URL de tu Infisical, sin `/api`                                                      |
| `INFISICAL_PROJECT_ID`    | ID del proyecto digitaltwin                                                          |
| `DIGITALTWIN_DB_PASSWORD` | contraseña de la BD (`openssl rand -hex 24`); **no la cambies** una vez creada la BD |

Los secrets son por repo: aunque ya los tengas en cadenceai o en el repo antiguo, hay que
añadirlos aquí. Desde la terminal: `gh secret set VPS_SSH_KEY < ~/.ssh/id_rsa` (y `gh secret set
NOMBRE` para los demás, te pide el valor).

### 3.4 Cloudflared

El bot **no** necesita nada expuesto, pero la web sí: en el túnel de cloudflared apunta un hostname
a `http://digitaltwin-web:80` (cloudflared tiene que estar en la red `red-n8n`). nginx sirve el
front y reenvía `/api` (y con él los webhooks de Google Health) a la API. Ese hostname es el
`PUBLIC_URL` de `/api`, y con dos proxies delante, `TRUST_PROXY=2`.

---

## 4. Primer despliegue

1. Para el bot local si usa el mismo token que producción (ver aviso del apartado 1).
2. Haz push a `main` (o _Actions → digitaltwin deploy → Run workflow_).
3. Comprueba en el VPS:

   ```bash
   cd /opt/digitaltwin/app
   sudo docker compose -f docker-compose.prod.yml ps        # todos "running", la API "healthy"
   sudo docker logs digitaltwin-bot --tail 20               # "Bot @... escuchando (long polling)"
   ```

4. Crea tu usuario (te pide la contraseña):

   ```bash
   sudo docker exec -it digitaltwin-api node scripts/create-user.js --email yo@x.com --name Yo --role admin
   ```

5. Vincula tu Telegram con tu usuario, para que las comidas del bot queden a tu nombre: en la web,
   **Conexiones → Bot de Telegram → Vincular**. Se abre el bot con un código de un solo uso; pulsa
   _Iniciar_ y listo (o escríbele `/vincular <código>`). Atajo de administrador sin web:
   `make telegram email=yo@x.com id=<id de Telegram>`.

6. Escribe al bot de producción lo que has comido.

---

## 5. Día a día

| Quiero...                     | Cómo                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desplegar                     | push a `main` o lanzar el workflow a mano                                                                                                                      |
| Cambiar un secreto            | editarlo en Infisical; el proceso se reinicia solo (`--watch`)                                                                                                 |
| Ver logs                      | `sudo docker logs -f digitaltwin-api` / `digitaltwin-bot`                                                                                                      |
| Reiniciar                     | `cd /opt/digitaltwin/app && sudo -E docker compose -f docker-compose.prod.yml restart` (*)                                                                     |
| Volver a una versión anterior | `git revert` del commit y push (se despliega como cualquier otro cambio)                                                                                       |
| Añadir un cliente de la API   | añadir `nombre:clave` a `DIGITALTWIN_API_KEYS` en `/api` (separado por coma)                                                                                   |
| Revocar un cliente            | quitar su entrada de `DIGITALTWIN_API_KEYS`                                                                                                                    |
| Construir una imagen en local | `docker build --build-arg APP=api .` (o `APP=bot`, `APP=worker`)                                                                                               |
| Ver qué hace el worker        | `sudo docker logs -f digitaltwin-worker` (con `LOG_LEVEL=debug`, cada trabajo)                                                                                 |
| Copia de la BD                | sola cada noche a Drive ([§6](#6-copias-de-seguridad)); a mano: `sudo docker exec digitaltwin-db pg_dump -U digitaltwin -Fc digitaltwin > dt-$(date +%F).dump` |
| Forzar una sincronización     | botón Sincronizar en Conexiones, o `/sincroniza` (`/sincroniza google`) en el bot                                                                              |

(*) Para `up`/`restart` a mano, exporta antes `INFISICAL_DOMAIN`, `INFISICAL_PROJECT_ID`, el
acceso (`INFISICAL_TOKEN` o `INFISICAL_CLIENT_ID` + `INFISICAL_CLIENT_SECRET`) y
`DIGITALTWIN_DB_PASSWORD`: el compose los necesita para arrancar los contenedores.

---

## 6. Copias de seguridad

Cada noche (`BACKUP_CRON`, por defecto a las 4:00) el worker hace `pg_dump` de toda la BD, lo
cifra con [age](https://age-encryption.org) y lo sube a Google Drive, a la carpeta
`digitaltwin-backups` (`BACKUP_DRIVE_FOLDER`). Se guardan los últimos 30 días
(`BACKUP_KEEP_DAYS`) y la del día 1 de cada mes durante un año. Cómo va la última: en la web,
Sistema → Copias de seguridad. Si falla del todo, llega un aviso push a los administradores.

Secretos en Infisical `prod` → `/api`:

| Secreto                | Qué es                                                                          |
| ---------------------- | ------------------------------------------------------------------------------- |
| `BACKUP_DRIVE_TOKEN`   | el JSON que da `rclone authorize drive` (permiso `drive.file`: solo ve lo suyo) |
| `BACKUP_AGE_RECIPIENT` | la clave **pública** de age (`age1…`)                                           |

La clave **privada** (`AGE-SECRET-KEY-…`) no está en el servidor: la guarda el dueño (gestor de
contraseñas). Sin ella las copias no se pueden abrir.

### Restaurar

1. Descarga el fichero de Drive (`dt-AAAA-MM-DDTHHMMZ.dump.age`).
2. Descífralo con la clave privada (en un fichero `clave.agekey`):

   ```bash
   age --decrypt --identity clave.agekey dt-2026-10-22T0200Z.dump.age > dt.dump
   ```

3. Cárgalo en una BD vacía con TimescaleDB, entre `timescaledb_pre_restore()` y
   `timescaledb_post_restore()`:

   ```bash
   sudo docker cp dt.dump digitaltwin-db:/tmp/dt.dump
   sudo docker exec -it digitaltwin-db psql -U digitaltwin -d digitaltwin \
     -c "select timescaledb_pre_restore();"
   sudo docker exec -it digitaltwin-db pg_restore -U digitaltwin -d digitaltwin \
     --no-owner --clean --if-exists /tmp/dt.dump
   sudo docker exec -it digitaltwin-db psql -U digitaltwin -d digitaltwin \
     -c "select timescaledb_post_restore();"
   ```

---

## 7. Problemas frecuentes

| Síntoma                                                          | Causa / solución                                                                                    |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| El bot no responde y en el log sale `409: Conflict`              | Otra instancia usa el mismo token (¿`make up` en local?). Usa un bot de desarrollo.                 |
| El bot contesta "Tu ID de Telegram es..."                        | `TELEGRAM_ALLOWED_USER_IDS` vacío: pon tu ID.                                                       |
| El bot ignora tus mensajes                                       | Tu ID no está en `TELEGRAM_ALLOWED_USER_IDS` (el log dice `usuario no autorizado` con tu `userId`). |
| `API 401 UNAUTHORIZED` en el bot                                 | `DIGITALTWIN_API_KEY` del bot no coincide con ninguna clave de `DIGITALTWIN_API_KEYS` de la API.    |
| `API 503 LLM_NOT_CONFIGURED`                                     | Falta `LLM_API_KEY` en la API.                                                                      |
| `API 502 LLM_API_ERROR: ... Insufficient Balance`                | Sin saldo en DeepSeek.                                                                              |
| El contenedor se reinicia en bucle con `Configuración inválida`  | Falta o está mal una variable; el mensaje dice cuál. Revisa la carpeta de Infisical.                |
| `The provided access token is malformed` / `Invalid credentials` | Token o Client ID/Secret de Infisical mal copiados, o `INFISICAL_DOMAIN` de otra región (US/EU).    |
| `failed to fetch secrets for path "/api"` con 403/404            | La identidad no tiene acceso a ese entorno, o el slug del entorno o la carpeta no coinciden.        |
| El deploy falla en _Comprobar los secrets_                       | Falta algún secret del repo (apartado 3.3); el error dice cuáles.                                   |
| El deploy falla en _Tests, lint y formato_                       | Lo mismo que `make check` en local (`make format` arregla el formato) y vuelve a hacer push.        |
