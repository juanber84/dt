# @digitaltwin/google-health

Cliente de la [Google Health API v4](https://developers.google.com/health): conexión de la cuenta por OAuth,
lectura de **todos** los tipos de datos (36, incluido el electrocardiograma) y **webhooks** para enterarse
de los cambios sin hacer polling.

## 1. Conectar la cuenta (API ⇄ front)

```js
import { GoogleHealthAuth } from '@digitaltwin/google-health';

const auth = new GoogleHealthAuth({ clientId, clientSecret, redirectUri });

// GET /api/v1/google-health/connect → redirigir al usuario
const url = auth.getAuthUrl({ state }); // state aleatorio guardado en la sesión (anti-CSRF)

// GET /api/v1/google-health/callback?code&state → comprobar state y:
const credentials = await auth.exchangeCode(code);
// { access_token, refresh_token, expiry_date, scope, healthUserId } → guardar (cifradas) en BD
```

Por defecto pide todos los scopes de lectura (`DEFAULT_SCOPES`). `healthUserId` es lo que llega en los
webhooks, así que conviene indexarlo para saber de qué usuario es cada aviso.

## 2. Leer datos (worker)

```js
import {
  GoogleHealthClient,
  listDataPoints,
  getAllData,
  toRecord,
} from '@digitaltwin/google-health';

const client = new GoogleHealthClient({
  credentials: await db.google.getCredentials(userId),
  clientId,
  clientSecret,
  onCredentialsRefreshed: (c) => db.google.saveCredentials(userId, c), // el access token dura 1 h
});

const points = await listDataPoints(client, 'heart-rate', { from, to, timeZone: 'Europe/Madrid' });
const { data, errors } = await getAllData(client, { from, to }); // todos los tipos
const rows = points.map((p) => toRecord('heart-rate', p)); // { id, dataType, start, end, date, value, dataSource, raw }
```

- El rango es `[from, to)` y los puntos salen en orden cronológico. La librería construye el filtro que
  pide cada tipo (`DATA_TYPES[].kind`): intervalo, muestra, diario (fecha local), sesión (hora local),
  sueño (por hora de fin) y ECG (solo "desde"; el "hasta" se filtra en cliente). Por eso los tipos diarios
  y las sesiones necesitan `timeZone`.
- `toRecord` da un `id` estable para hacer upsert en una tabla genérica.
- Errores (`GoogleHealthError.code`): `REAUTH_REQUIRED` (refresh token caducado o revocado: el usuario tiene
  que volver a conectar), `PERMISSION_DENIED` (falta el scope), `RATE_LIMITED`, `INVALID_REQUEST`…
  `getAllData` sigue con el resto de tipos si uno falla y los devuelve en `errors`, salvo `REAUTH_REQUIRED`.

## 3. Webhooks

```
Google ──POST──▶ /webhooks/google-health ──▶ createWebhookHandler ──▶ 204 + notifications
                                                                       │
                     notificationToQuery(n) → { dataType, from, to } ◀─┘
                     listDataPoints(client, dataType, { from, to }) → upsert
```

- **Suscriptor (una vez por proyecto):** `GoogleHealthSubscribers` con una cuenta de servicio
  (rol Google Health API Editor). Con la política `AUTOMATIC`, todos los usuarios que conecten su
  cuenta quedan suscritos sin crear nada por usuario.
- **Endpoint:** `createWebhookHandler({ secret })` comprueba la cabecera `Authorization` y la firma ECDSA
  (`GOOGLE-HEALTH-API-SIGNATURE`) con el keyset público de Google, que cachea y vuelve a descargar si
  rotan las claves. Responde a la verificación del alta y normaliza los avisos. Necesita el body **crudo**.
- Google reintenta si no recibe un 204 y guarda los avisos hasta 7 días. Puede haber duplicados, así que
  el procesado tiene que ser idempotente (upsert por `toRecord().id`).
- Solo 28 tipos tienen webhook (`WEBHOOK_DATA_TYPES`). Quedan fuera, entre otros, el **ECG**, la SpO2
  puntual y el VO2 máx.: esos hay que seguir leyéndolos periódicamente.

## Probar con tu cuenta

```bash
make google-login                                   # abre el navegador; usa el client_secret.json de la raíz del repo
make google-login args="--import ../../../tokens.json"   # o reutiliza el tokens.json antiguo
make google-data                                    # todos los tipos, últimas 24 h
make google-data args="--types electrocardiogram --from 2025-11-23"
make google-data args="--profile"                   # identidad, perfil, ajustes, dispositivos
make google-data args="--list"                      # catálogo de tipos

# Webhooks (necesita una URL HTTPS pública, p. ej. un túnel de cloudflared/ngrok)
GOOGLE_HEALTH_WEBHOOK_SECRET="Bearer xxx" make google-webhook args="--fetch"
cloudflared tunnel --url http://localhost:8787
GOOGLE_APPLICATION_CREDENTIALS=sa.json GOOGLE_CLOUD_PROJECT_NUMBER=... GOOGLE_HEALTH_WEBHOOK_SECRET="Bearer xxx" \
  make google-subscriber args="create --id digitaltwin --url https://<túnel>/"
```

Todo se guarda en `packages/google-health/.local/` (ignorado por git). `DEBUG=1` muestra más detalle.
