# Fuentes y conexiones

| Fuente                     | Cómo se conecta                                                   | Qué trae                                                                                                                                                                                                                                                                       | Cada cuánto                                                   |
| -------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| **Google Health**          | Botón "Conectar" (tu cuenta de Google)                            | Lo del **Apple Watch y el iPhone** vía Apple Health → Google: sueño por fases, FC, VFC, FC en reposo, SpO2, frecuencia respiratoria, temperatura, VO2 máx., pasos, distancia, kcal, entrenos, hidratación… También lo que llega a Apple Health de otras apps (Garmin, báscula) | Al momento (Google avisa por webhook) y cada hora de respaldo |
| **Báscula (experimental)** | Tu usuario y contraseña de la báscula (y el código si te lo pide) | Báscula: peso, grasa, músculo, agua, grasa visceral, metabolismo basal… y tu perfil de la báscula                                                                                                                                                                              | Cada 30 min                                                   |
| **intervals.icu**          | Tu clave de API de intervals.icu                                  | Entrenos con potencia y TSS, fitness/fatiga/forma, wellness                                                                                                                                                                                                                    | Cada hora                                                     |
| **Fuerza (experimental)**  | Tu email y contraseña de la app de fuerza                         | Entrenos de fuerza con el detalle que Google no trae: ejercicios, series, repeticiones, peso, descanso y grupos musculares. Además, tu IA puede dejarte [plantillas](/ia/mcp#plantillas-de-fuerza) en la app                                                                   | Cada hora                                                     |
| **Bot de Telegram**        | Vincular desde Conexiones                                         | Comidas con macros, agua, medicación                                                                                                                                                                                                                                           | Al guardar                                                    |
| **La app**                 | —                                                                 | Lo que apuntas en Registrar e informes médicos                                                                                                                                                                                                                                 | Al guardar                                                    |

## El catálogo

En Ajustes → Conexiones salen también las plataformas que **no** se conectan directamente, para que se vea cómo llegan sus datos. Cada una tiene un estado:

| Estado               | Qué quiere decir                           | Plataformas                                                                      |
| -------------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| **Conexión directa** | Se conecta aquí, con su API oficial        | Google Health, intervals.icu                                                     |
| **A través de otra** | Sus datos llegan por una que sí se conecta | Apple Salud y Xiaomi (por Google), Garmin, Magene e iGPSport (por intervals.icu) |
| **Experimental**     | Se conecta aquí, por su API no oficial     | Báscula y Fuerza (experimentales)                                                |
| **Próximamente**     | Tiene API oficial, falta hacerla           | Strava, WHOOP, Ultrahuman, FatSecret, Motra                                      |
| **De TwinMe**        | Parte de la app                            | Bot de Telegram, informes médicos, Registrar                                     |

El catálogo vive en `apps/web/src/data/platforms.js`: categoría, estado, `via` (a través de cuál), qué datos da, enlaces (`ios`, `android`, `web` y `referral`, el de invitación, que va primero si lo hay) y logo. Los logos son el icono oficial de su app (del App Store, en `apps/web/public/platforms/`); donde no hay app, el de [simple-icons](https://simpleicons.org) (CC0) o un monograma. Si una plataforma manda su kit de marca, se cambia ese fichero.

La primera vez que conectas una fuente se trae tu histórico (Google: hasta dos años; fuerza: hasta cinco años, un detalle por entreno; todo por trozos y sin pasarse de los límites de cada API). El progreso se ve en Conexiones.

::: warning Báscula y Fuerza son experimentales
Entran por su API no oficial (la que usan sus apps), así que pueden dejar de funcionar si el servicio cambia algo. Solo salen en Conexiones a los administradores y a quien tenga activadas las **conexiones experimentales** (Administración → Usuarios).
:::

::: info El mismo entreno por dos fuentes
Un entreno de fuerza puede llegar por **Fuerza (experimental)** (con series y repeticiones) y también, como simple resumen, por **Google** (vía Apple Health). Cuando se solapan en el tiempo gana el de fuerza, que es la fuente directa y trae el detalle.
:::

::: info Retraso de Apple Health
El iPhone solo sube los datos a Google cuando abres la app de Google Health (y en segundo plano de vez en cuando). Si ves un día a medias, abre esa app en el iPhone.
:::

Si una conexión caduca (permiso retirado, contraseña cambiada), te llega una notificación y en Conexiones sale para volver a conectarla.

Las credenciales de cada conexión se guardan **cifradas** (AES-256-GCM) y nunca llegan al navegador.
