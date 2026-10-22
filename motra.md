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

**Credenciales** (como está implementado): cada usuario conecta su cuenta desde Conexiones con email y contraseña; la API hace el login una vez y guarda **solo el `refreshToken`** (cifrado, en `connections`), nunca la contraseña. Si Firebase lo rota, el worker guarda el nuevo. Si el usuario cambia la contraseña, el token muere (`TOKEN_EXPIRED`/`INVALID_REFRESH_TOKEN`) y la conexión pasa a "hay que reconectar". La API key de Firebase va por defecto en `packages/motra`; `MOTRA_FIREBASE_API_KEY` (worker) solo por si Motra la cambia.

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
- Capturas guardadas en `~/tools/motra-captures/motra.flows`.
- **Limpieza tras capturar**: parar proxy, quitar proxy del WiFi, **borrar el certificado** del iPhone.
