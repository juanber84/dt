# Plan: diseño

La sección **Plan** junta lo que decide cómo rindes y cómo cambia tu cuerpo: **entreno, comida,
sueño, salud y composición corporal**. Cada pieza se ajusta a las demás. Este documento es el
diseño antes de programar: qué hace, de dónde sale cada dato, con qué fórmulas y en qué orden se
construye. Lo que aún no está comprobado va marcado como **(a comprobar)**.

## Principios

1. **Los entrenos los decides tú (o tu entrenador).** El gemelo no cambia un plan ajeno: si algo no
   cuadra (VFC hundida, 5 h de sueño, enfermo), lo dice y sugiere; la decisión es tuya. Cuando el
   plan lo diseñas tú, el gemelo propone y tú confirmas antes de que se escriba en ningún sitio.
2. **El gemelo se ocupa de lo que rodea al entreno**: el combustible de cada día, el sueño, la
   recuperación, dónde encajar la fuerza y los objetivos de composición.
3. **Cifras nuestras, no del vendedor.** Lo calculamos con modelos sencillos y comprobables
   (`@digitaltwin/engine`) a partir de datos brutos (potencia, pasos, peso, comida); las kcal
   activas del reloj solo como contraste. La IA explica y redacta; no pone números.
4. **Nada inventado.** Lo que falta sale como "sin datos" y no como cero; lo estimado dice que lo
   es.
5. **Por usuario.** Cada uno sus fuentes, sus objetivos y su plan, aunque hoy haya uno.
6. **El bot de Telegram es para comidas y agua.** El Plan se ve y se toca en la app (y el coach).

## Lo que verás

Una pestaña **Plan** (en la barra del móvil y en el menú lateral) con:

1. **La semana**: cada día con sus entrenos (planificados y hechos), su objetivo de comida, la
   hora de dormir y la disposición. Hoy, arriba y más grande.
2. **Objetivos**: tu meta de composición corporal y cómo vas.
3. **El detalle de un día**: qué comer antes, durante y después de cada sesión, y por qué.

Y el resto de la app lo usa: Hoy enseña el objetivo del día ya ajustado, el informe de la mañana
cuenta qué toca hoy y el coach tiene la semana delante.

## Piezas

### 1. Objetivos de composición corporal

Sustituyen a "peso objetivo + ritmo" de Cuenta (que pasan a salir de aquí).

- **Qué eliges**: perder grasa manteniendo el músculo · recomposición (perder grasa ganando algo de
  músculo) · ganar músculo · mantener.
- **Datos**: los pesajes de la báscula (Xiaomi) con peso y % de grasa por bioimpedancia.
- **Fiabilidad de la bioimpedancia**: el valor de un día suelto falla varios puntos de % de grasa y
  depende del agua (bebida, sudor, sal, hora). La **tendencia** con la misma báscula, a la misma
  hora y todos los días es usable: el error se repite y se compensa. Por eso se trabaja con
  tendencias, no con pesajes sueltos.
- **Cálculo**: masa grasa = peso × % grasa; masa magra = peso − masa grasa. A las dos, la misma
  tendencia que al peso (media exponencial, ~10 % por día) y los mismos periodos (fuera de casa,
  enfermo). Se miran en kg, no en %.
- **La meta**: % de grasa objetivo manteniendo la masa magra → peso objetivo = masa magra /
  (1 − % objetivo). La fecha sale de un ritmo que no se coma el músculo: perder entre el 0,5 y el
  1 % del peso a la semana (más despacio cuanto más delgado), con proteína alta y fuerza.
- **Seguimiento**: "grasa ▼ 0,3 kg/semana, masa magra estable ✓". Si la masa magra baja varias
  semanas seguidas (más de lo que explica el ruido), aviso y ajuste: más proteína, menos déficit o
  más fuerza.
- **Proteína**: según la masa magra (como ya hace el motor), más alta en déficit.

### 2. Combustible por día

Hoy el objetivo es el mismo cada día (gasto medio − déficit). Pasa a ser un **presupuesto semanal
repartido según lo que haces cada día**.

- **Base**: el gasto de un día sin entreno = gasto real del motor − lo que entrenaste de media en
  esas semanas (para no contarlo dos veces).
- **Lo de cada día**, calculado por nosotros:
  - **Bici con potencia** (intervals.icu): kJ de trabajo ≈ kcal gastadas (eficiencia bruta ~20-25 %
    y 1 kcal = 4,184 kJ se compensan). Es lo más fiable que hay.
  - **Correr**: ~1 kcal por kg y km.
  - **Andar**: pasos por encima de tu media, según tu peso.
  - **Fuerza** (Motra): por duración y volumen; poca cosa comparada con la bici.
  - Otros entrenos sin potencia: duración × intensidad (FC), marcado como estimado.
- **El reparto**: la proteína fija, la grasa casi fija y lo que se mueve son **los hidratos**,
  según la carga del día: de ~3 g/kg en días suaves a 6-10 g/kg en días de mucho volumen o
  intensidad ("come para el trabajo que vas a hacer").
- **Durante el entreno**: en sesiones de más de ~90 min, 60-90 g de hidratos por hora (mezcla de
  glucosa y fructosa en lo alto del rango); antes y después, lo que toque según la hora.
- **El déficit es semanal**: se pierde grasa al mismo ritmo, solo cambia el reparto. Fuera de casa
  o enfermo, mantenimiento (como ya hacen los periodos).
- **Antes de que pase**: con el entreno planificado del día (intervals.icu), el objetivo se sabe
  desde la mañana; si luego haces otra cosa, se ajusta con lo real.

### 3. El plan de la semana

- **Fuentes**:
  - **intervals.icu**: los entrenos planificados de tu calendario, también los que te ponga un
    entrenador externo (escribe en tu calendario). La API los da como eventos con su descripción,
    duración y carga prevista **(a comprobar el formato: estructura, TSS/kJ previstos)**.
  - **Motra**: hoy leemos los entrenos hechos (series, reps, kilos). Si la app programa
    plantillas para un día **(a comprobar con otra sesión de sniffing: crear, programar y borrar
    una plantilla)**, también leeríamos las programadas.
  - Lo que hagas sin plan (Apple Watch, Garmin) entra como hecho.
- **Lo hecho frente a lo planificado**: cada sesión emparejada con su plan (hecha, más corta,
  saltada), con su carga real.
- **Escribir** (fase 5, siempre después de que confirmes):
  - En **intervals.icu** (API pública): los entrenos que diseñes tú, que llegan solos al Garmin o
    al Edge.
  - En **Motra**: la sesión de fuerza como plantilla para el día que toque, marcada como nuestra
    ("TwinMe · Pierna A") **(a comprobar)**. Es una API privada: solo crear y borrar lo nuestro,
    y si cambia, se para sin romper nada. Plan B: la sesión en intervals.icu como texto.

### 4. Disposición y sueño

- **Disposición (readiness)**: VFC (ln rMSSD) de los últimos 7 días frente a tu media de ~60, FC en
  reposo, sueño de anoche y de la semana, carga (CTL/ATL/TSB de intervals.icu), enfermo o fuera
  (periodos) y, si lo apuntas, cómo te sientes. Sale un estado sencillo (bien / ojo / descansa)
  con el porqué, no una nota mágica.
- **Sueño**: hora de acostarse según a qué hora madrugas y lo que necesitas (más tras días duros o
  enfermo), y cómo vas frente a eso en la semana.
- **Qué hace con ello**: lo enseña en el día y, si choca con lo planificado, sugiere ("con la VFC
  así, el umbral de hoy, consúltalo o hazlo en Z2"). No cambia nada solo.

### 5. Fuerza alrededor de la bici

- Dónde encajar las sesiones de fuerza para que no choquen con los días de calidad (nada de pierna
  pesada la víspera de series o de una salida larga).
- Propuestas con estructuras probadas (full-body 2-3 días, torso/pierna…), elegidas por reglas
  según la semana y el objetivo; la IA elige, ajusta y explica, no inventa rutinas.
- Progresión con tus series reales de Motra (cargas y repeticiones de verdad).

### 6. El coach

Con todo lo anterior delante: "mañana 3 h con 2×20 a umbral: hoy cena con hidratos, mañana
90 g/h en la salida y a la cama a las 23:00, que madrugas". Herramientas nuevas para el MCP y el
coach: el plan de la semana, el combustible de un día y los objetivos.

## Fases

Cada fase sirve por sí sola y se despliega al acabar.

1. **Combustible por día**: base + lo de cada día con nuestros cálculos (potencia, carrera,
   pasos, fuerza) y el reparto de hidratos; presupuesto semanal. Se ve en Hoy ("Hoy: 2.400 kcal =
   base 1.650 + rodaje 750") y lo usan el coach y el informe.
2. **Objetivos de composición**: tendencias de grasa y masa magra, la meta y su seguimiento;
   Cuenta deja de pedir peso objetivo y ritmo.
3. **Plan de la semana**: leer lo planificado de intervals.icu (y de Motra si se puede), emparejar
   con lo hecho y la pestaña Plan; el combustible usa lo planificado.
4. **Disposición y sueño**.
5. **Proponer y escribir**: fuerza alrededor de la bici, y escribir en intervals.icu (y Motra) lo
   que confirmes.

## Por comprobar antes de empezar cada fase

- **Fase 1**: que los kJ de las actividades de intervals.icu llegan bien (ya leemos actividades)
  y cuánto entrenas de media para restarlo a la base.
- **Fase 2**: con tus pesajes, cuánto ruido tiene la grasa de la Xiaomi día a día y si la
  tendencia es estable.
- **Fase 3**: el formato de los entrenos planificados en la API de intervals.icu; y una sesión de
  sniffing en Motra para las plantillas.

## Referencias

- Thomas, Erdman y Burke (2016). Posicionamiento ACSM/AND/DC sobre nutrición y rendimiento:
  hidratos de 3-5 a 8-12 g/kg según la carga del día.
- Jeukendrup (2014). Hidratos durante el ejercicio: 30-60 g/h y hasta 90 g/h en esfuerzos largos
  con mezcla glucosa-fructosa.
- Impey et al. (2018). "Fuel for the work required": periodizar los hidratos según la sesión.
- Morton et al. (2018). Proteína para ganar masa magra: ~1,6 g/kg, hasta ~2,2.
- Helms et al. (2014). En déficit, proteína más alta (2,3-3,1 g/kg de masa magra) y perder
  0,5-1 % del peso por semana para conservar músculo.
- Garthe et al. (2011). Perder peso más despacio conserva mejor la masa magra en deportistas.
- Plews et al. (2013). VFC (ln rMSSD) en media de 7 días para guiar el entreno.
- Banister / Coggan. Carga de entreno: CTL, ATL y TSB.
- Walsh et al. (2021). Consenso sobre sueño y deportistas.
