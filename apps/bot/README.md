# @digitaltwin/bot

Bot de Telegram para registrar lo que comes. Le escribes (o mandas una foto) y te devuelve los
alimentos con su hora y sus macros; al pulsar **✅ Guardar** lo manda a la API
(`POST /api/v1/nutrition/entries`).

El bot es solo la interfaz: no sabe nada de IA. Las macros las calcula la API
(`/api/v1/nutrition/analyze` y `/refine`), que es donde se configura el LLM (DeepSeek, OpenAI...). **✏️ Corregir** (o contestar a la propuesta) recalcula con
lo que le digas y **❌ Descartar** la cierra. Las propuestas guardadas o cerradas pierden los botones.

Usa long polling: no necesita webhook ni puertos abiertos, funciona igual en local que en el VPS.

## Puesta en marcha

```bash
make bot-env                  # crea apps/bot/.env
# rellena TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USER_IDS y DIGITALTWIN_API_KEY
# en apps/api/.env: DIGITALTWIN_API_KEYS=bot:<la misma clave> y LLM_API_KEY (la de DeepSeek)
make dev                      # API
make bot                      # bot (en otra terminal)
```

Solo responde a los IDs de `TELEGRAM_ALLOWED_USER_IDS`; los demás se ignoran. Si lo dejas vacío,
el bot arranca en modo configuración y a quien le escriba solo le contesta con su ID: así sacas el
tuyo la primera vez.

Las propuestas pendientes viven en memoria (24 h): si reinicias el bot, sus botones avisan de que
han caducado y basta con volver a mandar el mensaje.
