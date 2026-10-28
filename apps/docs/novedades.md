# Novedades

## 28 de octubre de 2026

- **Ultrahuman en lugar de Oura** en Conexiones (próximamente): es un anillo sin suscripción, así que ni tú ni tus usuarios pagáis cuota por tener los datos. Su API oficial es para partners, hay que pedir acceso.

## 27 de octubre de 2026

- **Avisos de Google, sin errores**: Google ha empezado a devolver los tipos de cada suscripción con su nombre entero (`users/…/dataTypes/steps`). El worker creía que habían cambiado, intentaba corregirlos y Google lo rechazaba ("invalid argument") en cada revisión. Ahora se comparan por el tipo, y si un cambio de verdad no entra, la suscripción se rehace. Los datos no se han perdido: entraban igual por la sincronización de cada hora.
- **Menos disco en el servidor**: cada despliegue limpia la caché de build de más de un día (antes, de una semana: se juntaban unos 14 GB) y deja los logs del sistema en 300 MB.
- **Conexiones es un catálogo**: buscador, plataformas por categoría con el icono de su app y una ficha para cada una con qué datos da, cómo llega (directa, a través de otra, experimental o próximamente), tu conexión y dónde conseguirla. Salen también las que llegan a través de otra (Apple Salud, Garmin, Magene, iGPSport) y las que vienen (Strava, WHOOP, Oura, FatSecret, Motra). Las conexiones no oficiales dejan las marcas: la de fuerza pasa a ser **Fuerza (experimental)** (la de Motra será la oficial, por su MCP) y la de la báscula, **Báscula (experimental)**; Xiaomi sale como _a través de Google Health_ (Zepp Life → Apple Salud → Google). Ver [Fuentes y conexiones](/datos/fuentes#el-catalogo).
- **Límite de IA por usuario**: cada persona puede gastar hasta 0,25 $ al día de la IA de la app (coach, comidas, informes médicos y el comentario del informe de la mañana); se reinicia a medianoche y en Usuarios se cambia por persona. Al llegar, el coach y las comidas lo dicen, un informe médico no se sube y el de la mañana sale sin comentario. En Cuenta → IA se ve lo gastado hoy. Ver [Límite y clave propia](/ia/limites).
- **Tu propia clave de IA**: en Cuenta → IA puedes poner una clave de DeepSeek, OpenAI, OpenRouter, Groq, Mistral o Gemini con el modelo que quieras. Se prueba antes de guardarla, va cifrada y con ella no hay límite (lo pagas tú). Si tu clave falla, se te dice; no se usa la de la app por detrás.
- **Usuarios** (Administración): dar de alta, editar, desactivar y borrar usuarios desde la web, sin scripts. Por usuario se activan funciones extra. Las **cuentas demo** sirven para enseñar el producto: no reciben informe ni avisos y caducan al mes. Una cuenta desactivada o caducada no entra, su sesión y sus tokens del MCP dejan de valer, y sus conexiones se pausan (ni sincronizaciones ni avisos de Google) hasta que se reactive. Ver [Ajustes](/guia/ajustes#administracion-solo-administradores).
- **Xiaomi y Motra, experimentales**: como entran por su API no oficial, solo los ven los administradores y quien tenga activadas las conexiones experimentales; en Conexiones llevan la etiqueta _Experimental_. Quien ya los tenía conectados los sigue teniendo.

## 26 de octubre de 2026

- **Suplementos**: en Ajustes → Cuenta, tu lista (creatina, magnesio, vitamina D, omega-3 u otro) con dosis, momento y desde cuándo; en Hoy, un chip por cada uno para marcarlo al tomarlo, y en Registrar → Suplemento para apuntar uno de otro día o uno suelto. El coach sabe cuáles tomas y cuántos días los marcas. Ver [Hoy](/guia/hoy#suplementos).
- **Creatina**: las 4 semanas después de empezarla (o dejarla), Hoy, el informe y el coach avisan de que el peso sube (o baja) 1-2 kg de agua, no grasa. El motor no cambia sus cuentas. Ver [Peso real](/motor/peso#creatina).
- **Registrar en el iPhone**: las fechas y horas ya no se salen del popup.
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
