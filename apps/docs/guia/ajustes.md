# Ajustes

## Cuenta

- **Tus datos**: sexo, fecha de nacimiento, altura y peso objetivo (lo no escrito sale de la báscula).
- **Para el motor**: ritmo de peso por semana y "apunto todo lo que como desde".
- **Suplementos**: los que tomas a diario (creatina, magnesio, vitamina D, omega-3 u otro), con su dosis, cuándo los tomas y desde cuándo. Salen en [Hoy](/guia/hoy#suplementos) para marcarlos. Cuando dejas uno, **Lo dejo** guarda la fecha y pasa a "Los que has dejado"; **Volver a tomarlo** lo empieza de nuevo. Lo que tiene calorías (proteína en polvo, barritas, geles) no es un suplemento: va como comida.
- **Apariencia**: oscuro (por defecto), claro o el del sistema.
- **Face ID** y **Notificaciones**: ver [La app en el móvil](/guia/movil).
- **Correo**: a qué dirección te llegan los correos (la de tu cuenta), un botón para mandarte uno de prueba y los últimos enviados. Aquí también el [informe de la mañana](/guia/informes): si lo quieres, a qué hora, y un botón para que te mande ya el de ayer. Salen de `informe@twinme.app`; si no lo ves, mira en spam y márcalo como "no es spam".
- **IA**: cuánto llevas gastado hoy de tu IA diaria, o tu propia clave de un proveedor (DeepSeek, OpenAI, OpenRouter, Groq, Mistral o Gemini) para usarla sin límite. Ver [Límite y clave propia](/ia/limites).
- **Acceso para tu IA (MCP)**: tokens personales para conectar Claude u otra IA a tus datos. Ver [MCP](/ia/mcp).
- **Cerrar sesión**.

## Conexiones

Un catálogo de plataformas por categoría (reloj y salud, entreno, ciclismo, báscula, comida y lo de TwinMe), con buscador. Arriba, **tus conexiones** y si alguna necesita atención. Cada plataforma tiene su **ficha** (`/admin/connections/<plataforma>`): qué datos da, cómo llega a TwinMe (directa, a través de otra, experimental o próximamente), tu conexión con sus botones (conectar, sincronizar, desconectar; en el bot, vincular) y dónde conseguirla (App Store, Google Play, web o su enlace de invitación). Ver [Fuentes y conexiones](/datos/fuentes).

## Administración (solo administradores)

- **Usuarios**: dar de alta (con contraseña puesta o generada, que se enseña una sola vez), cambiar nombre, rol y contraseña, desactivar (no puede entrar, su sesión deja de valer y sus conexiones dejan de sincronizarse, sin desconectarlas: al reactivarlo se trae lo que falte; sus datos se quedan) y borrar (con todos sus datos). Por usuario se activan las funciones extra, de momento las **conexiones experimentales** (Báscula y Fuerza; los administradores ya las tienen). Una **cuenta demo** es para enseñar el producto, por ejemplo a un servicio con el que integrarnos: no recibe el informe por correo ni avisos push y caduca al mes (la fecha se cambia o se quita). Una cuenta caducada no puede entrar. A quien no sea administrador se le puede cambiar el **gasto de IA al día** (vacío: el de por defecto, 0,25 $); ver [Límite y clave propia](/ia/limites).
- **Fuentes**: qué fuente manda cuando dos dicen lo mismo.
- **IA**: qué modelo usa cada función, saldo y gasto.
- **Sistema**: estado de la API, la base de datos, el bot, el worker, las copias de seguridad y la IA; la cola de trabajos, lo último que ha llegado de fuera y los últimos trabajos.
