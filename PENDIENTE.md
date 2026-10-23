# Pendiente

Cosas por hacer. Cómo se despliega está en [INSTALL.md](INSTALL.md). La sección **Plan** (entreno,
combustible por día, objetivos de composición, sueño) tiene su diseño en [PLAN.md](PLAN.md).

## Datos

- [ ] **Periodos, lo que falta** (hecho el 23/10: Registrar → Periodo, motor, Hoy, coach,
      informe y aviso de comidas; ver apps/docs/motor/periodos.md):
  - Que la app lo proponga si llevas 2 días sin pesarte ni apuntar ("¿estás fuera?"), con un aviso
    push (el bot es solo para comidas y agua).
  - La franja del periodo en las gráficas de Tendencias.
  - Pesajes de otra báscula fuera de casa: hoy se descartan todos los de esos días; si un día se
    distingue la báscula (origen), se podrían enseñar aparte.
- [ ] **Suplementos (creatina, magnesio, vitamina D, omega-3…).** Como tomas, aparte de la
      medicación: lista de "mis suplementos habituales" en Ajustes (dosis y momento) y marcarlos
      de un toque en Hoy o por el bot ("los de siempre"). Lo que tiene calorías (proteína en
      polvo, barritas, geles) va como comida. El motor y el coach deben saber cuándo empieza la
      creatina (sube 1-2 kg de agua las primeras semanas: no es grasa).
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

- [ ] **Observabilidad (como Elastic antes, sin pagar ni instalarlo). SIN DECIDIR:** hay que ver
      cómo y con qué. Lo único claro: nada de guardar el tráfico en nuestra BD. Lo que se ha
      hablado, como propuesta: medir con **OpenTelemetry** (estándar: el código vale para
      cualquier proveedor) y mandarlo a **Grafana Cloud** (plan gratis: logs, métricas, trazas,
      alertas y comprobaciones desde fuera). Volumen real: ~4 MB de logs al día (~120 MB/mes).
  - Agente Grafana Alloy en el VPS: CPU/RAM/disco del servidor y de cada contenedor, y los logs de
    Docker (solo nuestros contenedores, sin los /health).
  - OpenTelemetry en la API (cada endpoint) y en el worker (una traza por trabajo: sync, fetch,
    normalize, clinical-extract, push, db-backup…), con las llamadas a Google, Xiaomi,
    intervals.icu y DeepSeek. Ojo: `postgres.js` no se mide solo (pg-boss sí, usa `pg`).
  - Métricas de la cola (pendientes, en marcha, fallidos por cola) cada minuto.
  - Alertas: API caída, errores disparados, cola atascada, worker sin latido, backup que no sale.
  - Alternativas valoradas: Axiom (logs), Netdata (estado en tiempo real), OpenObserve en el VPS
    - UptimeRobot (lo más parecido a Elastic autoalojado), y New Relic gratis (100 GB/mes, APM ya hecho, 8 días; solo 500
      comprobaciones desde fuera al mes → UptimeRobot aparte). Con OpenTelemetry se puede cambiar.
  - 21/10: probado New Relic (cuenta EU, clave de ingesta `digitaltwin-prod` creada; no está
    guardada en ningún sitio: crear otra si se monta). Preferencia: **OpenTelemetry** (Collector en
    el compose con un interruptor + SDK en API, worker y bot, con la traza pasando por la cola vía
    el `wrap` de `jobs.js`) mandando por OTLP, en vez del agente propio de New Relic (más
    `privileged` y ata al proveedor). Plan por pasos: primero el collector (servidor,
    contenedores y logs), y las trazas si convence. **Parado** por decisión del usuario.
  - Falta: decidir herramienta y alcance; luego, la cuenta y sus credenciales.

- [ ] **Rediseñar Sistema (es enorme y no dice lo importante).** Propuesta: arriba una frase de
      estado ("Todo funciona" / "2 cosas a mirar" con enlaces), servicios en una rejilla compacta,
      4 cifras de las últimas 24 h, y el detalle plegado (solo colas con algo, entradas agrupadas,
      trabajos fallidos por defecto). Aparcado por el usuario.

- [ ] **Envío de correos: informe del día.** El uso principal: cada día (o por la mañana, del
      día anterior) un correo con el resumen: peso real y gasto, lo comido frente al objetivo
      (kcal y macros), sueño, pasos, entreno, salud (síntomas, medicación) y unas frases del coach
      con lo importante y qué hacer hoy. Las cifras salen del motor y del timeline (nada inventado,
      "sin datos" si falta algo); el texto, del coach. Más adelante, también semanal. Otros usos
      que pueden venir: contraseña y alta cuando haya registro, avisos sin push, informes de
      Clínica.
  - Hecho (23/10): **Resend** con `twinme.app` verificado (SPF, DKIM, DMARC), `@digitaltwin/email`
    (envío, plantilla base, historial `email_log` sin duplicados), job `email` en el worker y en
    Cuenta el correo de prueba y el historial.
  - Hecho (23/10): **informe de la mañana** por bloques (`@digitaltwin/reports`): el worker lo hace
    a la hora de cada usuario (por defecto 9:00, en Cuenta se cambia o se apaga), lo guarda
    (`reports`) y lo manda con las gráficas en PNG incrustadas; en la app, Informes. El comentario
    es del coach; las cifras, de la BD y del motor.
  - Falta: **informes a demanda** desde el coach (`create_report`: elige bloques y redacta, el
    servidor resuelve los datos); informe semanal.

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
