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

## Producción

- [ ] **Copia automática de la BD (aparcado).** Ahora no hay ninguna: si se pierde el volumen del
      VPS, se pierde todo. Por ejemplo, un cron diario en el VPS:
      `sudo docker exec digitaltwin-db pg_dump -U digitaltwin -Fc digitaltwin > /opt/digitaltwin/backups/dt-$(date +%F).dump`,
      y llevarse la copia fuera del VPS, cifrada (lleva datos de salud).
- [ ] **Ver las peticiones a la API (observabilidad).** Ahora solo están en `docker logs`. Nada de
      guardar el tráfico en nuestra BD (más puntos de fallo en la API y no escala): mandar los
      logs de pino a un servicio hecho para eso (Grafana Cloud/Loki, Axiom o Better Stack, plan
      gratis) con un transport. Lo que llega de fuera ya queda en la tabla `inbox` (30 días).

## App en el móvil (PWA)

- [ ] **Más avisos push.** La base está (Ajustes → Cuenta → Notificaciones; reglas en
      `apps/worker/src/notifications.js`). Faltan los que dependen de datos que aún no llegan bien:
  - Agua ("llevas 0,5 L de 3 L"): antes, que Registrar guarde en la API (ahora el agua, los
    síntomas y las notas solo viven en memoria y se pierden al recargar).
  - Pasos al final del día: los pasos llegan cuando se abre la app de Google en el iPhone, así
    que hay que decir "según lo último sincronizado" o esperar a otra fuente.
  - Ideas: proteína a media tarde, varias noches durmiendo poco, días sin pesarse, y que el coach
    redacte los avisos.
