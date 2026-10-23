# API

La API de Digital Twin es REST con JSON, en `https://twinme.app/api/v1`. La usa la propia web; todo lo que ves en la app sale de aquí.

## Autenticación

| Quién                             | Cómo                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Personas** (la web)             | Cookie de sesión `dt_session` (JWT firmado, HttpOnly, SameSite=Strict) tras `POST /auth/login` o `POST /auth/passkey` |
| **Clientes de servidor** (el bot) | `Authorization: Bearer <clave>` con una clave de API de cliente                                                       |
| **Tu IA**                         | [MCP](/ia/mcp) con un token personal `dt_…`                                                                           |

## Convenciones

- Fechas en **ISO 8601** con zona (`2026-10-21T08:00:00+02:00`) y días locales `YYYY-MM-DD`; la zona por defecto es `Europe/Madrid` (`tz` para cambiarla).
- Errores con su estado HTTP y `{ "error": { "code": "…", "message": "…" } }`.
- **Límite de peticiones** por IP (429 si se pasa); el login, aparte y más estricto.
- Las rutas de administración exigen rol `admin`.

## Ejemplo

```bash
# Entrar (guarda la cookie)
curl -c cookies.txt -X POST https://twinme.app/api/v1/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"tu@email.com","password":"…"}'

# El estado del motor
curl -b cookies.txt https://twinme.app/api/v1/engine
```

Ver la [referencia](/api/referencia) y los [webhooks](/api/webhooks).
