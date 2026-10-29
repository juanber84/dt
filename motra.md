# Motra — notas para el ingestor (reverse engineering de la app iOS)

> Obtenido el 2026-10-22 snifando la app de iOS con mitmproxy en la LAN (proxy en el PC, iPhone saliendo por él, CA instalado y de confianza).
> **La app NO hace certificate pinning**, así que todo el tráfico se descifra sin trucos.
> Cuenta propia del usuario, datos propios. Esto son notas para construir un ingestor `motra` más adelante.

## TL;DR

- Backend REST propio en `https://backend.motra.com`.
- Auth = **Firebase** (email/contraseña). Cada request lleva `Authorization: Bearer <idToken de Firebase>`.
- Trae **sets/reps/peso/descanso/grupos musculares** por serie — justo lo que Google Health no da.
- **App Check (DeviceCheck) NO se exige en las lecturas** → verificado reproduciendo una lectura desde el PC (otra IP/dispositivo, sin iPhone, solo Bearer) → `200` con datos reales.
- ⇒ Ingestor **headless viable** solo con email + contraseña + Firebase API key. Sin Pro, sin MCP, sin iPhone en medio.

---

## Autenticación (Firebase Auth)

Proyecto Firebase: `train-165d3`. La **Firebase API key** es pública y viaja en el `?key=` de las llamadas de auth (hay que leerla de una captura o del bundle de la app).

### 1. Login inicial (una vez)

```
POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<FIREBASE_API_KEY>
Content-Type: application/json

{ "email": "<email>", "password": "<pass>", "returnSecureToken": true }
```

Respuesta: `idToken` (el Bearer, caduca ~1 h) + `refreshToken` (persistente).

> La app usa el endpoint legacy `identitytoolkit/v3/relyingparty/verifyPassword`; el equivalente moderno es `accounts:signInWithPassword` de arriba (mismo resultado).
> Motra también admite "Entrar con Google", pero el usuario usa email/contraseña → no hace falta OAuth.

### 2. Refrescar el token (cada ~1 h)

```
POST https://securetoken.googleapis.com/v1/token?key=<FIREBASE_API_KEY>
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=<refreshToken>
```

Respuesta: `id_token` nuevo + `refresh_token` (puede rotar → guardar el nuevo).

### 3. Llamar al backend

```
Authorization: Bearer <idToken>
```

**Credenciales** (como está implementado): cada usuario conecta su cuenta desde Conexiones con email y contraseña; la API hace el login una vez y guarda **solo el `refreshToken`** (cifrado, en `connections`), nunca la contraseña. Si Firebase lo rota, el worker guarda el nuevo. Si el usuario cambia la contraseña, el token muere (`TOKEN_EXPIRED`/`INVALID_REFRESH_TOKEN`) y la conexión pasa a "hay que reconectar". La API key de Firebase de la app va en el secreto `MOTRA_FIREBASE_API_KEY` (API y worker), no en el código.

---

## Endpoints del backend (`https://backend.motra.com`)

### Índice de entrenos

```
GET /user/calendar-workouts/v3?startTimestamp=<unix_secs_float>&endTimestamp=<unix_secs_float>
```

Timestamps en **segundos unix** (float). Respuesta:

```json
{
  "success": true,
  "data": {
    "2026-10-14": [
      {
        "workoutID": "7E377467-...",
        "timeStarted": 1791991053,
        "timeEnded": 1791995184,
        "activityType": "traditionalStrengthTraining",
        "workoutFormat": "trainStrength"
      }
    ]
  }
}
```

→ recorrer todo el histórico paginando por rangos de fechas.

### Detalle de un entreno (lo bueno: sets/reps/peso)

```
GET /workout/{workoutID}/details
```

Respuesta `data.workout` con claves:
`timeStarted`, `timeEnded`, `workoutID`, `userID`, `accessLevel`, `name`,
`activities[]`, `setMap{}`, `exerciseDetails{}`, `backendExercises`, `customExerciseData`, `cardioExerciseMap`, `statistics`.

- **`activities[]`** → orden del entreno. Cada una:
  `{ "segment": "main", "strengthExercise": { "exercises": [ { "setIDs": [ "<setID>", ... ] } ] } }`
- **`setMap{ setID → serie }`** → el dato de cada serie:
  ```json
  {
    "setID": "D3DE8512-...",
    "exerciseTypeID": "barbellBenchPress",
    "phase": "main",
    "loggedAt": 1791546786.93,
    "restTime": 125.9,
    "measurements": { "reps": 4, "time": 29.9, "weight": { "value": 60, "unit": "kg" } },
    "metrics": {}
  }
  ```
- **`exerciseDetails{ exerciseTypeID → ficha }`** → catálogo del ejercicio:
  ```json
  {
    "ezBarPreacherCurl": {
      "id": "...",
      "exerciseTypeID": "ezBarPreacherCurl",
      "name": "EZ-Bar Preacher Curl",
      "category": "reps",
      "tracking": { "primaryMetric": "reps", "allowedMetrics": ["reps", "time"] },
      "equipmentGroups": ["ezBar", "other"],
      "primaryMuscleGroups": ["biceps"],
      "secondaryMuscleGroups": ["forearms"],
      "trainingStyle": ["bodybuilding"]
    }
  }
  ```
- **`statistics`** → `{ "calories": 186 }`

### Otros endpoints vistos (no imprescindibles)

- `GET /user/settings`
- `GET /user/getting-started`
- `GET /user/profile/{userID}/header-details`
- `PUT /user/health-data/aggregated` — la app _sube_ pasos/kcal activas por día (no nos sirve para leer).
- `POST /user/health-data/flush`
- Imágenes de ejercicios: `GET https://cdn.motra.com/exercise-assets/{hash}/thumbnailOriginal.jpg`

### Plantillas y escritura (captura del 2026-10-29)

Segunda sesión de sniffing: crear, editar y borrar una plantilla y registrar un entreno. Ninguna escritura lleva cabecera de App Check, solo el Bearer. **Verificado desde el PC** (solo Bearer, otra IP): `DELETE /template`, `PUT /template` (restaurada una plantilla idéntica a la copia) y `DELETE /workout` dan `200`.

| Acción                    | Llamada                                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Listar mis plantillas     | `GET /user/template/my-templates?size=10&sortBy=matchScore` (resumen: id, nombre, ejercicios, nº series, duración, músculos, `publicHash`)                                                       |
| Listar por recuperación   | `GET /user/template/basic-details/v3?size=20&page=1&sortBy=recoveryScore&sortDirection=desc`                                                                                                     |
| Leer una                  | `GET /template/{templateID}/details` → `data.template`                                                                                                                                           |
| **Crear o editar**        | `PUT /template/{templateID}` (upsert, sobrescribe entera)                                                                                                                                        |
| **Borrar**                | `DELETE /template/{templateID}` (sin cuerpo) → `{"success":true}`. El id queda quemado: un `PUT` posterior con ese id da `404 Template is deleted`                                               |
| Borrar un entreno hecho   | `DELETE /workout/{workoutID}` → `{"success":true}` (no capturado, probado desde el PC)                                                                                                           |
| Etiquetas                 | `GET /user/template/tags` (las del usuario). En el `PUT` van al lado de `template` (`"tags": [{"name": "TwinMe", "color": "orange"}]`) y vuelven en `/details` → `template.tags`, no en la lista |
| Enlace público            | `https://motra.com/share/template/{publicHash}` (lo que la app llama "exportar")                                                                                                                 |
| Buscar ejercicios         | `GET /in-workout-search/exercises?page=1&size=40&query=&muscleGroups=&equipmentGroups=&trainingStyle=&type=custom\|autoDetected&onlyFavourites=true&currentExerciseIDs=`                         |
| Historial de un ejercicio | `GET /exercise/{exerciseTypeID}/history`, `/pr-breakdown`, `/summary`                                                                                                                            |
| Últimos pesos y reps      | `GET /user/latest-weight-and-reps`                                                                                                                                                               |

**Crear/editar plantilla.** El `templateID` y los `setID` los genera el cliente (UUID en mayúsculas): un `PUT` con un id nuevo crea la plantilla y con uno existente la reemplaza.

```json
PUT /template/CC2404CF-BDEE-44B5-BA20-465EA151EE50
{
  "template": {
    "templateID": "CC2404CF-...", "userID": "<uid>",
    "name": "Jueves Noche Plantilla de entrenamiento", "caption": "Esta es una prueba",
    "accessLevel": "private",
    "setMap": {
      "FBAE4458-...": { "setID": "FBAE4458-...", "exerciseTypeID": "bodyweightSquat", "phase": "main",
                        "restTime": 129, "measurements": { "reps": 12, "weight": { "value": 0, "unit": "kg" } } }
    },
    "activities": [
      { "segment": "main", "strengthExercise": { "exercises": [ { "setIDs": ["FBAE4458-...", "..."] } ] } }
    ],
    "cardioExerciseMap": {}
  },
  "tags": []
}
→ {"success": true}
```

- Un elemento de `activities` por ejercicio, y el orden de `setIDs` es el orden de las series. `restTime` va en segundos. `measurements.time` es opcional.
- Es el mismo formato de `setMap`/`activities` que un entreno hecho.
- Plan gratis: **2 plantillas como máximo**. Para generar sesiones basta un `PUT` sobre una plantilla fija nuestra, sin borrar y crear (si se borra, hay que crearla con un id nuevo).

**Registrar un entreno hecho** (la app al terminar):

```
POST /workout/{workoutID}      (workoutID generado por el cliente)
{ "metadata": {"timezone": "Europe/Madrid"},
  "workout": { workoutID, userID, timeStarted, timeEnded, statistics:{calories}, setMap, activities, cardioExerciseMap },
  "source": "phoneLiveWorkout" }
→ {"success": true}
```

Después la app pide `GET /workout/{workoutID}/save-summary`, que devuelve el entreno con el nombre que le pone el servidor.

TwinMe marca las suyas con la etiqueta `TwinMe` (naranja) y solo reescribe o borra esas. Lo hace el adaptador `packages/motra/src/strength-app.js`, que cumple el contrato común de `@digitaltwin/strength`; las herramientas `*_strength_template` del MCP (`packages/mcp/src/strength-tools.js`) solo hablan con ese contrato.

Copia de las plantillas del usuario (JSON de `/details`) en `~/tools/motra-captures/templates-backup/`, fuera del repo.

### Servicios de terceros que usa la app (ignorables para el ingestor)

RevenueCat (suscripciones), Intercom (soporte), Branch (deeplinks), Mixpanel/Statsig (analítica), FCM (push).

---

## Implementación (2026-10-22)

Mismo patrón que intervals.icu:

- `packages/motra` — cliente: `signInWithPassword` (solo al conectar) y `createMotraClient({ refreshToken })` con `calendarWorkouts` / `workoutDetails`; renueva el idToken y reintenta una vez si da 401.
- `apps/api/src/services/motra-connect.js` + `POST /api/v1/connections/motra/connect`.
- `apps/worker/src/providers/motra.js` — índice por tramos de 180 días → detalle de cada entreno → un `raw_record` (`provider=motra`, `kind=workout`, `external_id=workoutID`). Una semana de solape; histórico de 5 años en el backfill; cron `MOTRA_SYNC_CRON` (min 40 de cada hora). El `activityType` solo viene en el índice: se copia al payload.
- `packages/timeline/src/normalizers/motra.js` — episodio `workout` (`schema motra.workout@1`) con `details.exercises[].sets[]` (reps, kg, tiempo, descanso) y resumen (series, reps, volumen Σ reps·kg, músculos). Libras → kg.
- Migración `0019`: prioridad `motra=30`, por delante de Google (50). El mismo entreno llega por Google vía Apple Health (origen `com.trainfitness.Train`) y, como se solapan, en Entrenos sale solo el de Motra.

### Notas / riesgos

- El `idToken` caduca ~1 h → se renueva solo con el refresh token.
- App Check no se exige **hoy** en lecturas; si algún día lo activasen en modo enforce, el ingestor headless dejaría de funcionar (plan B: MCP con Pro, o Hevy).
- Respetar rate limits (hacer las llamadas de detalle con un poco de margen, no en ráfaga).
- `timeStarted`/`timeEnded` en segundos unix; `weight.unit` puede variar (kg) — normalizar unidades.

---

## Cómo se capturó (para repetir si hace falta)

- mitmproxy 11 en venv: `~/tools/mitmproxy-venv/`
- Arranque: `~/tools/motra-captures/start-sniff.sh` (proxy `0.0.0.0:8888`, web UI `127.0.0.1:9090`).
- iPhone: WiFi → proxy manual `IP_DEL_PC:8888`; CA desde `http://mitm.it` (o el `.pem` por email) + **confiar** en Ajustes → General → Información → Ajustes de confianza del certificado.
- Capturas guardadas en `~/tools/motra-captures/motra.flows` (lecturas, 10-22) y `motra-write.flows` (plantillas y escritura, 10-29).
- **Limpieza tras capturar**: parar proxy, quitar proxy del WiFi, **borrar el certificado** del iPhone.
