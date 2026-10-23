# Referencia

Todas bajo `/api/v1`. 🔒 = con sesión · 👑 = solo administradores · 🤖 = clientes con clave de API.

## Sesión

|        |                         |                                                       |
| ------ | ----------------------- | ----------------------------------------------------- |
| `POST` | `/auth/login`           | Entrar con usuario y contraseña (`remember`: 30 días) |
| `POST` | `/auth/passkey/options` | Reto para entrar con passkey (Face ID)                |
| `POST` | `/auth/passkey`         | Entrar con la respuesta del dispositivo               |
| `POST` | `/auth/logout`          | Salir                                                 |
| `GET`  | `/auth/session`         | Quién soy                                             |

## Perfil y cuenta 🔒

|                       |                                   |                                                                                                   |
| --------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET` `PUT`           | `/profile`                        | Sexo, nacimiento, altura, peso objetivo, ritmo y "apunto todo desde" (con el origen de cada dato) |
| `GET`                 | `/passkeys`                       | Tus passkeys                                                                                      |
| `POST`                | `/passkeys/options` · `/passkeys` | Dar de alta este dispositivo                                                                      |
| `DELETE`              | `/passkeys/:id`                   | Quitar una                                                                                        |
| `GET`                 | `/push`                           | Clave pública, tipos de aviso, preferencias, dispositivos e historial                             |
| `POST` `DELETE`       | `/push/subscriptions`             | Activar o quitar avisos en un dispositivo                                                         |
| `PUT`                 | `/push/settings`                  | Tipos apagados, horas de silencio, máximo diario                                                  |
| `POST`                | `/push/test`                      | Aviso de prueba                                                                                   |
| `GET` `POST` `DELETE` | `/tokens`                         | Tokens personales para el MCP                                                                     |

## Datos 🔒

|          |                          |                                                                                              |
| -------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `GET`    | `/timeline/metrics`      | Métricas con datos y desde cuándo                                                            |
| `GET`    | `/timeline/series`       | `from`, `to`, `metrics`, `bucket=day\|hour`, `tz`                                            |
| `GET`    | `/timeline/episodes`     | `from`, `to`, `kinds`, `all`, `tz`, `details` (`false`: solo el resumen, para rangos largos) |
| `GET`    | `/timeline/observations` | Datos crudos de una métrica                                                                  |
| `GET`    | `/engine`                | El [motor](/motor/): peso real, gasto, objetivos e historial                                 |
| `POST`   | `/entries`               | Registrar agua, bebida, peso, síntoma, nota o medicación                                     |
| `GET`    | `/entries/medications`   | Medicamentos ya apuntados (sugerencias)                                                      |
| `DELETE` | `/entries/:id`           | Borrar un registro                                                                           |

## Clínica 🔒

|          |                                                   |                                   |
| -------- | ------------------------------------------------- | --------------------------------- |
| `POST`   | `/clinical/documents`                             | Subir un PDF (`date` opcional)    |
| `GET`    | `/clinical/documents` · `/clinical/documents/:id` | Lista y detalle                   |
| `PUT`    | `/clinical/documents/:id`                         | Guardar la revisión               |
| `POST`   | `/clinical/documents/:id/confirm` · `/retry`      | Confirmar o volver a leer         |
| `DELETE` | `/clinical/documents/:id`                         | Borrar                            |
| `GET`    | `/clinical/parameters` · `/clinical/metrics`      | Parámetros confirmados y catálogo |

## Coach 🔒

|                |                                                     |                                                 |
| -------------- | --------------------------------------------------- | ----------------------------------------------- |
| `POST`         | `/coach/messages`                                   | Preguntar (respuesta en streaming, eventos SSE) |
| `GET` `DELETE` | `/coach/conversations` · `/coach/conversations/:id` | Conversaciones                                  |

## Conexiones 🔒

|                 |                                                        |                                                                              |
| --------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `GET`           | `/connections`                                         | Estado de cada fuente                                                        |
| `POST`          | `/connections/google-health/connect`                   | Empezar a conectar Google (OAuth)                                            |
| `POST`          | `/connections/xiaomi/login`                            | Conectar Xiaomi (y `…/:loginId/captcha`, `…/:loginId/email-code` si lo pide) |
| `POST`          | `/connections/intervals-icu/connect`                   | Conectar intervals.icu con tu clave                                          |
| `POST`          | `/connections/motra/connect`                           | Conectar Motra con email y contraseña (solo se guarda el token de sesión)    |
| `POST`          | `/connections/:provider/sync`                          | Sincronizar ahora                                                            |
| `DELETE`        | `/connections/:provider`                               | Desconectar                                                                  |
| `POST` `DELETE` | `/connections/telegram/link` · `/connections/telegram` | Vincular el bot                                                              |

## Nutrición 🤖

|        |                      |                                                                                                                                                                   |
| ------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/nutrition/analyze` | Estimar platos, macros y tipo de comida de un texto o una foto (también agua y medicación); con `telegramUserId` (el bot), tiene en cuenta lo ya apuntado ese día |
| `POST` | `/nutrition/refine`  | Corregir una estimación                                                                                                                                           |

## Administración 👑

|       |                          |                                                          |
| ----- | ------------------------ | -------------------------------------------------------- |
| `GET` | `/admin/ai`              | Modelos, saldo y gasto de la IA                          |
| `GET` | `/admin/system/activity` | Entradas de fuera, últimos trabajos, copias de seguridad |

## Salud del servicio

|       |                             |                                       |
| ----- | --------------------------- | ------------------------------------- |
| `GET` | `/health` · `/health/ready` | Viva · lista (BD, bot, worker, colas) |
