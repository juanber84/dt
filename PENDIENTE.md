# Pendiente

Cosas por hacer. Cómo se despliega está en [INSTALL.md](INSTALL.md).

## Datos

- [ ] **Calcular nosotros el gasto de la actividad, sin fiarnos del reloj.** La energía activa del
      Apple Watch parece alta: el 19/10 fueron 517 kcal con unos 7.400 pasos y sin entreno.
      Calcularla con nuestros datos (pasos, distancia, FC por hora, peso de la báscula) y
      compararla con la del reloj antes de usarla en el balance de kcal. Primero mirar qué marca
      la app Salud en "Energía activa" esos días, para saber si el reloj se pasa o si fallamos
      nosotros.
- [ ] **Afinar el margen entre reloj e iPhone en los pasos.** Ahora son 15 minutos (`WATCH_GAP_MS` en
      `packages/timeline/src/normalizers/google.js`) y solo está ajustado con el 19/10. Comparar
      con los pasos de Salud del 10, 15, 17 y 18/10.
- [ ] **Suscribirse a los cambios de Google Health (webhooks).** Ahora Google entra solo por el
      cron de cada hora; con el webhook, Google avisa en cuanto hay datos nuevos. Pasos:
  1. nginx (`docker/web-nginx.conf`) solo reenvía `/api/` a la API, y el webhook está en
     `/webhooks/google-health`: añadir un `location /webhooks/` igual que el de `/api/`.
  2. `GOOGLE_HEALTH_WEBHOOK_SECRET` en Infisical `prod` `/api`: la clave sola (el `Bearer ` lo añade la API)
     (clave de `openssl rand -hex 32`). Sin él, la API no monta la ruta.
  3. Crear el suscriptor una vez, con una cuenta de servicio con rol _Google Health API Editor_:
     `make google-subscriber args="create --id digitaltwin --url https://dt.cadenceai.ovh/webhooks/google-health"`
     (con `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT_NUMBER=579742134918` y el mismo
     `GOOGLE_HEALTH_WEBHOOK_SECRET`). Google llama a la URL para verificarla: prod tiene que estar
     arriba.

## Producción

- [ ] **Copia automática de la BD (aparcado).** Ahora no hay ninguna: si se pierde el volumen del
      VPS, se pierde todo. Por ejemplo, un cron diario en el VPS:
      `sudo docker exec digitaltwin-db pg_dump -U digitaltwin -Fc digitaltwin > /opt/digitaltwin/backups/dt-$(date +%F).dump`,
      y llevarse la copia fuera del VPS, cifrada (lleva datos de salud).

## App en el móvil (PWA)

- [ ] **Estados de carga al navegar.** Al cambiar de pantalla (o de día en Hoy) no se ve que esté
      cargando y parece roto: hueco en blanco o datos viejos hasta que llega la respuesta. Poner
      esqueletos (skeletons) en cada vista mientras carga y una barra fina arriba al navegar.
- [ ] **Tema y cerrar sesión en el móvil.** Solo están en la barra lateral, que en el móvil no se
      ve. Ponerlos en Ajustes con un selector Sistema / Claro / Oscuro (el botón actual fija claro u
      oscuro y nunca vuelve a "sistema"). Con el iPhone en oscuro la app instalada sale en blanco:
      ver si es el tema guardado o la barra de estado (`apple-mobile-web-app-status-bar-style`).
- [ ] **Entrar con Face ID.** Con passkeys (WebAuthn): el iPhone las guarda en el llavero y pide
      Face ID al usarlas. Hace falta registrar la passkey desde la web ya con sesión y un login
      alternativo con ella. Solo funciona con HTTPS y el dominio de producción.
- [ ] **Notificaciones.** Web Push: en iOS solo con la app instalada en la pantalla de inicio
      (iOS 16.4+). Necesita un service worker, que ahora no hay a propósito para que no haya
      caché: al añadirlo, que no cachee nada (solo push), o habrá que pensar cómo se actualiza.
