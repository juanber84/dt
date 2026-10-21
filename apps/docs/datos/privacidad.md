# Privacidad y seguridad

## Dónde están tus datos

En **tu servidor** (una base de datos PostgreSQL con TimescaleDB). No se venden ni se comparten.

## Acceso

- **Contraseña** (guardada con scrypt) o **Face ID / Touch ID** con passkeys (WebAuthn): en el servidor solo queda la clave pública.
- La sesión es una cookie **HttpOnly** y **SameSite=Strict** (ningún script de la página puede leerla).
- Para la API y el MCP, **tokens personales** que puedes revocar (solo se guarda su hash).

## Credenciales de tus conexiones

Cifradas con AES-256-GCM en la base de datos; nunca llegan al navegador.

## La IA

- Los **informes médicos** se mandan a la IA **sin tus datos personales** (nombre, DNI, dirección, teléfonos…), que se quitan antes en el servidor.
- Lo que hablas con el **coach** y los datos que consulta sí van al proveedor de IA (DeepSeek) para poder contestarte.
- La IA nunca escribe ni borra nada en tus datos: solo lee.

## Copias de seguridad

Cada noche se hace una copia de toda la base de datos, **cifrada** (age) con una clave cuya parte privada solo tiene el dueño, y se sube a Google Drive (a una carpeta propia; el permiso solo ve lo que crea la copia). Se guardan 30 días y la del día 1 de cada mes durante un año.

## Notificaciones

Solo llegan a los dispositivos donde las actives; el contenido viaja cifrado por el servicio de push de Apple o Google.
