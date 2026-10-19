# @digitaltwin/xiaomi

Login en Xiaomi Cloud por pasos (captcha + código por email) y lectura de la báscula de bioimpedancia.
Es un port de `xiaomi/scaleconnect_mac_arm64/xiaomi-login-session.js` y `xiaomi-scale-cloud.js`, con las mismas
peticiones, adaptado para usarse desde la API (login) y desde un proceso periódico (datos).

## Login (API ⇄ front)

Cada paso devuelve un `status` y, si falta algo, un `state` serializable que la API guarda **en servidor**
(BD/Redis, con TTL corto) asociado a un `loginId`. El `state` lleva cookies y el hash de la contraseña:
nunca se envía al front.

```js
import { XiaomiAuth, LoginStatus } from '@digitaltwin/xiaomi';

const auth = new XiaomiAuth({ logger });

let r = await auth.start({ username, password });
// r.status === 'CAPTCHA_REQUIRED'    → front pinta <img src={r.captcha.image}> y pide el texto
r = await auth.submitCaptcha(r.state, '7xk2');
// r.status === 'EMAIL_CODE_REQUIRED' → front pide el código que llega por email
r = await auth.submitEmailCode(r.state, '123456');
// r.status === 'AUTHENTICATED'       → guardar r.credentials (cifradas) para el proceso de datos
```

| status                | qué devuelve                                                   | siguiente paso    |
| --------------------- | -------------------------------------------------------------- | ----------------- |
| `CAPTCHA_REQUIRED`    | `captcha.image` (data URL), `captchaRetry`, `state`            | `submitCaptcha`   |
| `EMAIL_CODE_REQUIRED` | `state`                                                        | `submitEmailCode` |
| `AUTHENTICATED`       | `credentials` `{ userId, serviceToken, ssecurity, passToken }` | —                 |

Errores: `XiaomiError` con `code` → `INVALID_CREDENTIALS`, `INVALID_CAPTCHA`, `INVALID_EMAIL_CODE`
(se puede reintentar con el mismo `state`), `INVALID_LOGIN_STATE`, `SESSION_EXPIRED`, `UNEXPECTED_RESPONSE`, `API_ERROR`.

## Datos de la báscula (proceso periódico)

```js
import { XiaomiCloudClient, XiaomiAuth, getScaleMeasurements } from '@digitaltwin/xiaomi';

const client = new XiaomiCloudClient({
  credentials: await db.xiaomi.getCredentials(userId), // vienen de tu BD
  region: 'de',
  // si el token caducó, la librería lo renueva con passToken, reintenta y te pasa las nuevas
  onCredentialsRefreshed: (credentials) => db.xiaomi.saveCredentials(userId, credentials),
});
const measurements = await getScaleMeasurements(client, { from: lastSyncDate, to: new Date() });
// ordenadas de más antigua a más reciente; `id` estable (did:createTime) para upsert
```

La librería no lee ni escribe ficheros ni BD: las credenciales entran como objeto y salen como objeto
(`AUTHENTICATED` en el login y `onCredentialsRefreshed` al renovar). Si la renovación falla, la llamada lanza
`SESSION_EXPIRED` y el usuario tiene que volver a hacer login desde el front. `autoRefresh: false` la desactiva;
`client.refreshCredentials()` la fuerza.

`getScales(client)` lista las básculas de la cuenta (para saber el `model`; por defecto `yunmai.scales.ms104`).

## Probar con tu cuenta

```bash
make xiaomi-login                                   # usuario, contraseña, captcha, código email
make xiaomi-data                                    # todo el histórico
make xiaomi-data args="--from 2026-09-01"           # desde una fecha
make xiaomi-data args="--devices"                   # básculas de la cuenta
```

Las credenciales, el captcha y las mediciones se guardan en `packages/xiaomi/.local/` (ignorado por git).
`DEBUG=1` muestra las peticiones.
