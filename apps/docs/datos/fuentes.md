# Fuentes y conexiones

| Fuente              | Cómo se conecta                                               | Qué trae                                                                                                                                                                                                                                                                       | Cada cuánto                                                   |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| **Google Health**   | Botón "Conectar" (tu cuenta de Google)                        | Lo del **Apple Watch y el iPhone** vía Apple Health → Google: sueño por fases, FC, VFC, FC en reposo, SpO2, frecuencia respiratoria, temperatura, VO2 máx., pasos, distancia, kcal, entrenos, hidratación… También lo que llega a Apple Health de otras apps (Garmin, báscula) | Al momento (Google avisa por webhook) y cada hora de respaldo |
| **Xiaomi**          | Tu usuario y contraseña de Xiaomi (y el código si te lo pide) | Báscula: peso, grasa, músculo, agua, grasa visceral, metabolismo basal… y tu perfil de la báscula                                                                                                                                                                              | Cada 30 min                                                   |
| **intervals.icu**   | Tu clave de API de intervals.icu                              | Entrenos con potencia y TSS, fitness/fatiga/forma, wellness                                                                                                                                                                                                                    | Cada hora                                                     |
| **Motra**           | Tu email y contraseña de Motra                                | Entrenos de fuerza con el detalle que Google no trae: ejercicios, series, repeticiones, peso, descanso y grupos musculares                                                                                                                                                     | Cada hora                                                     |
| **Bot de Telegram** | Vincular desde Conexiones                                     | Comidas con macros, agua, medicación                                                                                                                                                                                                                                           | Al guardar                                                    |
| **La app**          | —                                                             | Lo que apuntas en Registrar e informes médicos                                                                                                                                                                                                                                 | Al guardar                                                    |

La primera vez que conectas una fuente se trae tu histórico (Google: hasta dos años; Motra: hasta cinco años, un detalle por entreno; todo por trozos y sin pasarse de los límites de cada API). El progreso se ve en Conexiones.

::: warning Xiaomi y Motra son experimentales
Entran por su API no oficial (la que usan sus apps), así que pueden dejar de funcionar si el servicio cambia algo. Solo salen en Conexiones a los administradores y a quien tenga activadas las **conexiones experimentales** (Administración → Usuarios).
:::

::: info El mismo entreno por dos fuentes
Un entreno de fuerza puede llegar por **Motra** (con series y repeticiones) y también, como simple resumen, por **Google** (vía Apple Health). Cuando se solapan en el tiempo gana el de Motra, que es la fuente directa y trae el detalle.
:::

::: info Retraso de Apple Health
El iPhone solo sube los datos a Google cuando abres la app de Google Health (y en segundo plano de vez en cuando). Si ves un día a medias, abre esa app en el iPhone.
:::

Si una conexión caduca (permiso retirado, contraseña cambiada), te llega una notificación y en Conexiones sale para volver a conectarla.

Las credenciales de cada conexión se guardan **cifradas** (AES-256-GCM) y nunca llegan al navegador.
