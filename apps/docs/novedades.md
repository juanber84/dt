# Novedades

## 26 de octubre de 2026

- **Por dentro, más ordenado**: el timeline de la web y el coach, partidos en piezas pequeñas con sus tests; nada cambia por fuera. Dependencias al día (`npm audit` sin avisos) y esta documentación en VitePress 2. El enlace "Abrir la app" de aquí arriba ya lleva a twinme.app.

## 25 de octubre de 2026

- **Observabilidad en Grafana Cloud**: comprobaciones desde fuera (España, París y Frankfurt) cada 2 min, métricas del servidor, de cada contenedor y de la app (peticiones, colas, latidos, copias), los logs y trazas de cada petición, mensaje al bot y trabajo del worker (la traza sigue por la cola). Dashboard _TwinMe · Estado_ y 15 alertas por correo: caída desde fuera, worker o bot sin latido, 5xx, trabajos fallando, colas atascadas, copia que no sale, disco, memoria… Ver [Observabilidad](/arquitectura/observabilidad).
- **Aviso antes de que caduque Google**: si al permiso de Google le quedan menos de 2 días (pasa a los 7 días mientras la app de Google esté en modo Prueba), te llega un aviso para volver a conectarlo.
- **Avisos de Google vigilados**: Google dejó de entregar los avisos de datos nuevos el 24 de octubre sin dar error (los datos seguían entrando cada hora, con retraso). Ahora cada usuario tiene su propia suscripción (manual, que se puede comprobar) en vez de la automática de Google, hay una alerta si pasa un día sin avisos y un script para ver las entregas y arreglarlo. El worker ya no reescribe el suscriptor en cada arranque.
- **Fallido es fallido de verdad**: un intento que el worker va a repetir (por ejemplo, intervals.icu devolviendo 503 un rato) cuenta como reintento, no como fallo; la alerta de trabajos fallando solo salta con los que agotan sus reintentos.

## 23 de octubre de 2026

- **Periodos**: en Registrar → Periodo apuntas que estás fuera de casa o enfermo (con fechas, también por adelantado). Esos días el motor no aprende tu gasto, el objetivo pasa a mantenimiento, lo de otra báscula no entra y, al volver, el salto de agua casi no mueve la tendencia. Hoy, el coach y el informe lo saben. Ver [Periodos](/motor/periodos).
- **Informe de la mañana**: cada día a las 9:00 (se cambia en Cuenta), por correo y en la app (Informes), con lo de ayer: comida frente al objetivo, lo que comiste, calorías de la semana, peso y tendencia, sueño, pasos, entrenos, salud y unas frases del coach. Las cifras salen de tus datos; el coach solo comenta. Ver [Informes](/guia/informes).
- **Correo**: en Ajustes → Cuenta, un botón para mandarte un correo de prueba y el historial de los enviados. Es la base del informe de cada mañana, que viene después.
- **Tipo de cada comida**: desayuno, media mañana, comida, merienda, cena o picoteo. El bot lo saca de lo que dices o lo decide por la hora y lo que ya llevas ese día (un yogur después de cenar es picoteo), y lo enseña antes de guardar para poder corregirlo. Se ve en Hoy y lo usan el coach y el MCP. Las comidas de antes se quedan sin tipo.
- **Ahora se llama TwinMe**, con dominio nuevo: [twinme.app](https://twinme.app) (`dt.cadenceai.ovh` deja de funcionar). En el móvil hay que volver a añadir la app a la pantalla de inicio, dar de alta Face ID y activar los avisos (van atados al dominio).
- **Motra**: tus entrenos de fuerza con cada ejercicio, serie, repetición, peso y descanso; en la ficha del entreno, la tabla con tus series reales. Gana a la copia del mismo entreno que llega por Google.
- **El coach ve tu fuerza serie a serie** (`get_strength_sets` en el MCP): hasta 3 meses y por ejercicio, para seguir tu progresión de verdad.
- **Líquidos**: el café, el té, la leche y los zumos cuentan como hidratación (el alcohol no). En Hoy, los líquidos del día con el desglose de agua y otras bebidas, y un objetivo que sube los días que entrenas.
- **Registrar → Bebida**: tipos rápidos (café con leche, té, infusión, zumo…) con sus ml y su cafeína. El bot también calcula los ml y la cafeína de lo que bebes.

## 21 de octubre de 2026

- **El motor**: peso real, gasto real adaptativo (como MacroFactor) y objetivos de comida; en Hoy, Tendencias, el coach, la API (`/engine`) y el MCP (`get_engine`).
- **El coach te conoce**: tu perfil, tu salud de los últimos 14 días y las cifras del motor en cada respuesta.
- **Tus datos** en Ajustes → Cuenta (sexo, nacimiento, altura, peso objetivo, ritmo, "apunto todo desde"), rellenos con la báscula.
- **Copia de seguridad diaria** cifrada a Google Drive.
- **Medicación**: cada toma desde Registrar o el bot, con sugerencias.
- **Agua por Telegram** (y te pregunta si no dices cuánta).
- **Registrar se guarda**: agua, café, peso, síntomas y notas, y se pueden borrar.
- **Notificaciones** por dispositivo: informe leído, conexión caída, comidas sin apuntar; horas de silencio y máximo diario.
- **Entrar con Face ID** (passkeys).
- **App en el móvil**: oscuro por defecto, cerrar sesión y tema en Cuenta, esqueletos al cargar, arranque oscuro, VO2 máx. con las constantes, "sin datos" en vez de ceros.
- **Sistema**: lo que llega de fuera, los últimos trabajos y las copias de seguridad.
- **Google al momento**: avisos de Google Health por webhook, con el suscriptor mantenido solo.
