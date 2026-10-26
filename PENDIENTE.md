# Pendiente

Cosas por hacer. Cómo se despliega está en [INSTALL.md](INSTALL.md). La sección **Plan** (entreno,
combustible por día, objetivos de composición, sueño) tiene su diseño en [PLAN.md](PLAN.md).

## Revisión del 23/10 (por orden)

- [ ] **1. Cortafuegos en el VPS.** `ufw` inactivo y abiertos a internet 3306 (MySQL de
      proyecto-x), 3005, 5000 (deepseek-proxy, pide clave), 8060, 8070 y 8083. No son de TwinMe pero
      comparten máquina. Dejar solo el 22 (lo web entra por el túnel de Cloudflare). Antes, ver si
      alguno se usa desde fuera por IP.
- [ ] **2. Local sin tocar las cuentas reales.** La BD local se copió de prod con sus conexiones: el
      worker local sincroniza Xiaomi, intervals.icu y Motra con las credenciales reales (doble carga,
      riesgo de bloqueo de Xiaomi) y podía mandar correos con datos viejos (el informe se apagó en
      local a mano). `PUBLIC_URL` de dev/bot apunta a prod. Un `DRY_RUN` (o similar) fuera de prod que
      apague sincronizaciones y envíos, o conexiones de prueba propias.
- [ ] **3. Tests con BD en CI.** El workflow pasa los tests normales pero no los ~150 con BD (no hay
      Postgres): meter TimescaleDB como servicio.
- [ ] **4. Despliegue con red.** `pg_dump` justo antes de migrar (la copia diaria es a las 4:00),
      comprobar `/health` y errores al acabar, y que el workflow falle en rojo si algo va mal.
- [ ] **5. Rotar claves que han pasado por el chat** (historial local de Claude Code): client secret
      de Google, tokens de los bots de Telegram, clave de Resend. Nueva → Infisical con el script por
      teclado → borrar la vieja. Primero la de Google.
- [ ] **6. Avisos mínimos**: comprobación externa de que twinme.app responde y aviso al móvil si el
      worker registra errores (lo de Grafana, en Producción, puede esperar).
- [ ] **7. Tope de gasto de IA** por usuario (ya está abajo, en IA): hoy solo se apunta y hay aviso
      de saldo bajo.
- [ ] **8. Navegación antes de Plan.** La barra del móvil está llena (Informes quedó fuera) y viene
      Plan: p. ej. Hoy · Plan · Tendencias · Coach · Más (Entrenos, Clínica, Informes dentro).
- [x] **9. Un solo sitio para cada cálculo** (hecho el 23/10, ea967fd): tipos de comida, líquidos,
      periodos y formato de cifras, en los paquetes; la web los importa.
- [x] **10. Web mantenible** (23/10 y 26/10): Hoy de 1.049 a 379 líneas, el lateral de Clínica de
      1.125 a 404; `services/timeline.js` en `services/timeline/` (api, días, un fichero por tipo
      de evento, resumen) y `CoachView.vue` de 810 a ~240 con `useCoachChat` y tres componentes,
      todo con tests. Quedan vistas de 500-570 líneas (Clínica, Sistema, Conexiones, Login),
      manejables; Sistema, mejor con su rediseño (abajo, en Producción).
- [ ] **11. Medicación por el bot**: el bot quedó para comidas y agua, pero apunta medicación.
      Decidir si se queda o se quita.
- [x] **12. Menores** (26/10): `npm audit` a 0 (audit fix y VitePress 2.0.0-alpha.20: la 1.6.4
      traía vite 5 y esbuild con avisos sin arreglo); la alerta de la clave de Firebase de Motra ya
      estaba cerrada como falso positivo (23/10).
- Datos y motor (ya apuntado en su sitio): objetivo de kcal plano y objetivos de peso pobres
  (PLAN.md), kcal activas del Watch infladas, Google borra el nombre de las fuentes de Apple Salud
  (HealthSave aparcado).

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

- [x] **Observabilidad (25/10): Grafana Cloud**, stack `juanber84`. `digitaltwin-alloy` (servidor,
      contenedores `digitaltwin-*`, logs y `/metrics` de la API), trazas OpenTelemetry en API, worker
      y bot (la traza sigue por la cola), comprobaciones desde fuera (España, París, Frankfurt),
      dashboard _TwinMe · Estado_ y 15 alertas por correo. Todo como código: `make grafana`.
      Ver INSTALL.md §7 y la documentación (Por dentro → Observabilidad).
  - Pendiente: las consultas de `postgres.js` no salen en las trazas (no hay instrumentación);
    enlazar logs ↔ trazas en Grafana (el `trace_id` ya va en cada log); las alertas solo por correo
    (¿push o Telegram aparte?).
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
