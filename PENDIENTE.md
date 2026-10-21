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

- [ ] **Ver las peticiones a la API (observabilidad).** Ahora solo están en `docker logs`. Nada de
      guardar el tráfico en nuestra BD (más puntos de fallo en la API y no escala): mandar los
      logs de pino a un servicio hecho para eso (Grafana Cloud/Loki, Axiom o Better Stack, plan
      gratis) con un transport. Lo que llega de fuera ya queda en la tabla `inbox` (30 días).

## IA (guardarraíles)

- [ ] **Seguridad médica en el coach.** Hoy solo hay una línea en el prompt ("no eres médico").
      Faltan: síntomas de alarma (dolor de pecho, falta de aire, fiebre muy alta, autolesión) →
      siempre "112 / urgencias" y nada más; no recomendar dosis ni cambios de medicación; no
      dietas extremas (tope de déficit). Mejor con una comprobación propia antes de responder que
      fiándolo solo al prompt.
- [ ] **Inyección de instrucciones.** Marcar en los prompts que lo que viene de PDFs, comidas o
      notas son datos, no órdenes (el coach solo lee, así que el daño posible es poco).
- [ ] **Tope de gasto de LLM por usuario** (diario o mensual). Ahora se apunta en llm_usage pero
      no se corta.
- [ ] **Privacidad con DeepSeek.** Lo que se habla con el coach y los datos de salud van tal cual
      (los PDFs sin datos personales). Con más usuarios: avisar y pedir consentimiento.

## App en el móvil (PWA)

- [ ] **Más avisos push.** La base está (Ajustes → Cuenta → Notificaciones; reglas en
      `apps/worker/src/notifications.js`). Faltan los que dependen de datos que aún no llegan bien:
  - Agua ("llevas 0,5 L de 3 L"): Registrar ya guarda en la API; falta que el bot apunte agua y
    decidir cuándo avisar (el usuario lo ha dejado para más adelante).
  - Pasos al final del día: los pasos llegan cuando se abre la app de Google en el iPhone, así
    que hay que decir "según lo último sincronizado" o esperar a otra fuente.
  - Ideas: proteína a media tarde, varias noches durmiendo poco, días sin pesarse, y que el coach
    redacte los avisos.
