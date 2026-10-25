# Webhooks

## Google Health → TwinMe

`POST /webhooks/google-health`. Google avisa en cuanto hay datos nuevos de cualquier usuario conectado: un solo suscriptor para todos, con política **manual** y una suscripción por usuario (`u` + su id sin guiones) con los tipos que concedió.

- **Verificación**: al crear o cambiar el suscriptor, Google llama dos veces: con la cabecera `Authorization` del secreto (debe dar 200) y sin ella (debe dar 401).
- **Avisos**: cada uno va **firmado** (ECDSA P-256 en `Google-Health-Api-Signature`) y se comprueba con las claves públicas de Google. Se responde 204 al momento y se procesa después.
- **Qué se hace**: se guarda en el buzón y se encola la descarga de ese tipo de dato y esos días (agrupando avisos seguidos).

El suscriptor y las suscripciones los mantiene solo el worker (trabajo `google-subscriber`): al arrancar, cada día y cada vez que alguien conecta o desconecta Google, crea lo que falta, corrige lo que ha cambiado y borra lo de usuarios que ya no están. Si ya está bien, no toca nada.

**Si dejan de llegar avisos.** Puede pasar que Google deje de entregarlos con el suscriptor activo y bien verificado. Pasó el 24 de octubre de 2026 con la política automática: ni fallos ni reintentos, simplemente no lo intentaba, y recrear el suscriptor no lo arregló. Por eso se pasó a suscripciones manuales, que sí se pueden listar y comprobar.

Al crear la de ese usuario, Google respondía `403` (`RESOURCE_PERMISSION_DENIED`) aunque su token seguía leyendo datos: su permiso para el proyecto ya no valía para los avisos. Con el cliente OAuth en modo Prueba el permiso caduca a los 7 días, y antes de caducar del todo deja de valer para esto. El worker apunta esos usuarios (`Google niega la suscripción: hay que volver a conectar Google`) y sigue con los demás; al volver a conectar, se crea la suscripción sola. Los datos siguen entrando por la sincronización de cada hora, pero con retraso. Lo avisa la alerta _Google no manda avisos_ (un día sin ninguno), y se arregla recreando el suscriptor con `scripts/google-subscriber.js --recreate` (ver `INSTALL.md`, Observabilidad). El mismo script enseña las entregas de las últimas 24 h y qué código les dimos, sacadas de Cloud Logging.

## Bot → TwinMe

`POST /webhooks/digitaltwin`. Eventos firmados con HMAC-SHA256 en `X-Digitaltwin-Signature: t=<unix>,v1=<hmac de "t.cuerpo">` (5 minutos de tolerancia).

| Evento           | Qué es                                                                                |
| ---------------- | ------------------------------------------------------------------------------------- |
| `meal.logged`    | Una comida confirmada, con sus platos y macros                                        |
| `entry.logged`   | Un registro suelto (agua, medicación…) con su id del bot (no se duplica si reintenta) |
| `account.link`   | Vincular Telegram con el código de la web                                             |
| `sync.requested` | Pedir una sincronización                                                              |
