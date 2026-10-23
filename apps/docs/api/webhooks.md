# Webhooks

## Google Health → TwinMe

`POST /webhooks/google-health`. Google avisa en cuanto hay datos nuevos de cualquier usuario conectado (un solo suscriptor para todos, con política automática).

- **Verificación**: al crear o cambiar el suscriptor, Google llama dos veces: con la cabecera `Authorization` del secreto (debe dar 200) y sin ella (debe dar 401).
- **Avisos**: cada uno va **firmado** (ECDSA P-256 en `Google-Health-Api-Signature`) y se comprueba con las claves públicas de Google. Se responde 204 al momento y se procesa después.
- **Qué se hace**: se guarda en el buzón y se encola la descarga de ese tipo de dato y esos días (agrupando avisos seguidos).

El suscriptor lo mantiene solo el worker: lo crea o corrige al arrancar y cada día.

## Bot → TwinMe

`POST /webhooks/digitaltwin`. Eventos firmados con HMAC-SHA256 en `X-Digitaltwin-Signature: t=<unix>,v1=<hmac de "t.cuerpo">` (5 minutos de tolerancia).

| Evento           | Qué es                                                                                |
| ---------------- | ------------------------------------------------------------------------------------- |
| `meal.logged`    | Una comida confirmada, con sus platos y macros                                        |
| `entry.logged`   | Un registro suelto (agua, medicación…) con su id del bot (no se duplica si reintenta) |
| `account.link`   | Vincular Telegram con el código de la web                                             |
| `sync.requested` | Pedir una sincronización                                                              |
