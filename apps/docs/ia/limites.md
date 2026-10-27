# Límite y clave propia

La IA trabaja en cuatro sitios: el [coach](/ia/coach), las comidas (web y bot de Telegram), la [lectura de informes médicos](/ia/informes) y el comentario del [informe de la mañana](/guia/informes). Cada llamada se apunta con sus tokens y su coste.

## Límite diario

Con la IA de la app, cada persona puede gastar **0,25 $ al día**. Con DeepSeek da para bastante: una pregunta normal al coach cuesta unas décimas de céntimo. El día empieza a medianoche (hora de Madrid).

- En **Cuenta → IA** se ve lo gastado hoy frente al límite.
- Un administrador puede cambiar el límite de cada persona en **Usuarios**; vacío vuelve al de por defecto (`AI_DAILY_LIMIT_USD`). Los administradores no tienen límite.
- Se comprueba **antes** de cada llamada. Una respuesta del coach que use varias herramientas puede pasarse un poco del límite: el corte llega en la siguiente.

Cuando se llega al límite:

| Dónde                | Qué pasa                                                                         |
| -------------------- | -------------------------------------------------------------------------------- |
| Coach                | Responde que has llegado al límite (429 `AI_LIMIT`), sin llamar al modelo        |
| Comidas (web y bot)  | Igual; el bot te lo dice con ⏳ y no como un fallo                               |
| Informes médicos     | No se puede subir ni reintentar; si ya estaba en cola, queda en error con motivo |
| Informe de la mañana | Sale igual, con sus cifras, pero sin el comentario del coach                     |

## Tu propia clave

En **Cuenta → IA → Usar mi propia clave** eliges un proveedor, el modelo y pegas tu clave. Con ella, todo lo de arriba va por tu cuenta y **no hay límite**: lo pagas tú. Lo que gastas se sigue apuntando, pero no cuenta para el límite.

Proveedores (todos con la API de OpenAI, `/chat/completions`):

| Proveedor     | Modelo de ejemplo         |
| ------------- | ------------------------- |
| DeepSeek      | `deepseek-flash`          |
| OpenAI        | `gpt-4.1-mini`            |
| OpenRouter    | `deepseek/deepseek-chat`  |
| Groq          | `llama-3.3-70b-versatile` |
| Mistral       | `mistral-small-latest`    |
| Google Gemini | `gemini-2.5-flash`        |

- **Solo de la lista**: la dirección de cada proveedor está en la app. No se puede escribir una URL, para que el servidor no llame a donde le digan.
- **Se prueba antes de guardar**: dos llamadas mínimas, una en modo JSON (comidas e informes) y otra con herramientas (coach). Si el proveedor la rechaza, se enseña su motivo y no se guarda.
- **Se guarda cifrada** (AES-256-GCM, con la misma clave que las credenciales de las conexiones). Nunca se vuelve a enseñar, solo sus 4 últimos caracteres. Para cambiar solo el modelo no hace falta volver a pegarla.
- **Si tu clave falla** (sin saldo, caducada…) se te dice el error del proveedor. No se usa la de la app por detrás.
- **Un modelo para todo**: el mismo para el coach, las comidas y los informes. Para las fotos de comidas tiene que admitir imágenes. Algunos modelos de razonamiento (los que no aceptan `temperature` o `max_tokens`) no pasan la prueba: elige uno normal.
- **Quitarla** la borra y vuelves a la IA de la app, con su límite.

## Por dentro

- `users.ai_daily_limit_usd`: el límite de cada persona (null: el de por defecto).
- `user_llm_providers`: proveedor, modelo y la clave cifrada.
- `llm_usage.own_key`: la llamada fue con la clave del usuario. El límite suma `cost_usd` de hoy sin estas.
- `@digitaltwin/llm-usage` (`createAiAccess`) decide en cada llamada con qué clave va. Lo usan la API y el worker.
