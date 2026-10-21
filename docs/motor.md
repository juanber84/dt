# El motor

El motor (`packages/engine`) calcula los números que importan para bajar grasa y rendir: tu peso
real, lo que gastas de verdad y lo que te toca comer. Es código con modelos sencillos y
comprobables, sin IA. Da siempre el mismo resultado con los mismos datos y tiene tests. El coach
(la IA) **explica** estos números; no calcula otros.

Principio: **no fiarnos de lo que diga cada marca** (Apple, Google, Garmin) y calcularlo nosotros,
que tenemos todos los datos juntos. Ejemplo: la "energía activa" del reloj iba de 21 a 1.607 kcal
en días normales. Con un error así no se puede llevar un déficit.

Se calcula al pedirlo (`GET /api/v1/engine`). Lo usan Hoy (objetivos de comida), Tendencias
(peso real y gasto) y el coach (en su contexto).

---

## 1. Peso real (tendencia)

El peso de la báscula sube y baja cada día por el agua (sal, hidratos, entreno, enfermedad).
Comparar dos pesajes no dice nada; la tendencia sí.

- **Huecos:** los días sin pesaje se rellenan en línea recta entre el pesaje anterior y el
  siguiente, como MacroFactor. Solo si el hueco es de **7 días o menos**: unir pesajes de hace
  semanas inventaría una tendencia. Tras un hueco largo, la tendencia vuelve a arrancar.
- **Tendencia:** media móvil exponencial con un **10 %** del peso nuevo cada día, como _The
  Hacker's Diet_ (J. Walker). MacroFactor usa una media que también pesa más lo reciente.
- **Arranque:** en la mediana de los primeros 5 pesajes. Si arrancara en el primero, un primer
  pesaje raro sesgaría la tendencia semanas.

## 2. Gasto real (adaptativo)

Es el corazón del motor y de MacroFactor. Por balance de energía:

> gasto = lo que comes − (lo que cambia tu peso tendencia × energía por kg)

Si comes 2.000 kcal de media y bajas 0,5 kg a la semana, gastas unas 2.000 + 0,5 × 7.700 / 7 ≈
2.550 kcal/día, diga lo que diga el reloj.

- **Gasto "efectivo":** sale de lo que **apuntas**. Si apuntas de menos de forma constante (lo
  normal: raciones a ojo, aceite, salsas, picoteo), el motor lo absorbe. El objetivo queda en tus
  mismas unidades de apuntar y, si lo cumples, el peso se mueve como quieres. La gente suele
  apuntar bastante menos de lo que come (Lichtman et al., 1992, NEJM: un 47 % de menos en
  personas que "no bajaban comiendo poco").
- **Energía por kg:** 7.700 kcal/kg es la de la grasa. Perdiendo deprisa entra también músculo,
  que tiene mucha menos (unas 1.800 kcal/kg). El motor usa una mezcla según el ritmo: 90 % grasa
  hasta el 0,5 %/semana, 80 % hasta el 1 %, 70 % por encima. La energía de lo perdido depende del
  ritmo y de la composición corporal (Hall, 2008, _Int J Obes_: "What is the required energy
  deficit per unit weight loss?").
- **Punto de partida:** metabolismo basal × actividad.
  - **Basal:** Mifflin-St Jeor (Mifflin et al., 1990, _Am J Clin Nutr_), la fórmula más precisa en
    adultos (Frankenfield et al., 2005, _J Am Diet Assoc_).
  - **Actividad:** según tus pasos de media.
  - **Rebaja, como MacroFactor:** un 6 % porque las fórmulas tienden a pasarse, y 4 veces el ritmo
    de pérdida buscado, porque en déficit el cuerpo gasta algo menos.
- **Predictor:**
  - **Cuándo corrige:** cada día con al menos **4 días bien apuntados en la última semana**. El
    gasto estimado se acerca al observado un paso: más grande los **30 primeros días**
    (calibración, como MacroFactor) y más fino después. Así no sobrerreacciona a una semana rara.
  - **Qué días cuentan:** desde "apunto todo desde" (Ajustes → Cuenta), con al menos 2 platos y con
    kcal razonables (no una comida suelta). Nunca el día en curso.
  - **Por qué tan estricto:** un día a medias es el punto débil de este método, y MacroFactor lo
    dice igual.
- **Confianza:** ninguna (solo fórmula), baja (< 7 días apuntados), media (< 21) o alta.
- **Aviso:** si lo apuntado no cuadra con el peso (según lo apuntado comes poco y no bajas), lo
  dice. O se escapa comida, o el peso va con agua.

## 3. Objetivos de comida

- **Ritmo** en **% del peso por semana** (por defecto −0,5 %). Al ir bajando, el déficit se ajusta
  solo. Para quien entrena, perder **0,5-1 %/semana**, y mejor hacia el 0,5 % si importa el
  rendimiento:
  - Helms et al., 2014, _IJSNEM_.
  - Garthe et al., 2011, _IJSNEM_: atletas que perdían al 0,7 %/semana mantuvieron la masa magra y
    mejoraron fuerza y potencia; los que iban al 1,4 %, no.
- **Kcal** = gasto real + ritmo × energía por kg / 7.
- **Proteína: 2,3 g por kg de masa magra.** La masa magra sale de la grasa de tu báscula; sin ese
  dato, 1,8 g/kg de peso.
  - En déficit, atletas delgados: 2,3-3,1 g/kg de masa magra para no perder músculo (Helms et al.,
    2014, _IJSNEM_).
  - Fuera de déficit, el beneficio se aplana hacia 1,6 g/kg de peso (Morton et al., 2018, _Br J
    Sports Med_).
- **Grasa: 0,8 g/kg** de peso (en torno al 25-30 % de las kcal). Por debajo de ~20 % de la energía
  se compromete la salud hormonal (Thomas, Erdman y Burke, 2016, posicionamiento ACSM/AND/DC).
- **Hidratos:** el resto. Es lo que se mueve con el entreno (ver "Siguiente").

---

## Lo que el motor no hace (todavía) y límites conocidos

- **Las kcal no se reparten aún según el entreno.** Para resistencia, los hidratos van según la
  carga del día: 3-5 g/kg en días suaves, 5-7 en moderados y 6-10 en duros (Thomas et al., 2016;
  Impey et al., 2018, _Sports Med_, "Fuel for the work required"). Es la siguiente fase: más los
  días de carga, el déficit en los de descanso.
- **Los factores de actividad por pasos son aproximados.** Solo cuentan para el punto de partida;
  con días apuntados manda lo observado.
- **El reloj no se usa para el gasto.** Los relojes fallan mucho estimando energía: en un estudio
  con 7 dispositivos ninguno bajó del 20 % de error (Shcherbina et al., 2017, _J Pers Med_). El
  motor nunca usa sus kcal.
- **Retención de agua** (enfermedad, antiinflamatorios, sal, viajes): mueve el peso días sin que
  cambie la grasa. La tendencia lo suaviza y los pasos pequeños del predictor no se dejan llevar,
  pero un periodo largo de agua sí despista un poco el gasto.
- **Los pesos exactos del algoritmo de MacroFactor no son públicos.** Seguimos lo que publican de
  su método (artículos de ayuda "Expenditure", "Weight Trend" y "Expenditure Modifiers").

## Siguiente

1. **Hidratos según el entreno** de cada día (planificado o hecho), con los rangos de arriba.
2. **Recuperación diaria:** VFC frente a tu media (ventana de 7 días contra la de 60), FC en
   reposo, sueño, cómo te sientes y si estás enfermo.
3. **Revisión semanal:** objetivos recalculados una vez por semana, con lo que pasó.
4. **Plan de entreno con potencia** (FTP, zonas y semanas de carga y descarga) hacia
   intervals.icu, y la carrera, progresiva.

## Referencias

Las referencias son de memoria. Antes de citarlas fuera, comprobarlas.

- Frankenfield D, Roth-Yousey L, Compher C. Comparison of predictive equations for resting
  metabolic rate in healthy nonobese and obese adults. _J Am Diet Assoc_. 2005;105(5):775-89.
- Garthe I, Raastad T, Refsnes PE, Koivisto A, Sundgot-Borgen J. Effect of two different
  weight-loss rates on body composition and strength and power-related performance in elite
  athletes. _Int J Sport Nutr Exerc Metab_. 2011;21(2):97-104.
- Hall KD. What is the required energy deficit per unit weight loss? _Int J Obes_.
  2008;32(3):573-6.
- Helms ER, Aragon AA, Fitschen PJ. Evidence-based recommendations for natural bodybuilding
  contest preparation: nutrition and supplementation. _J Int Soc Sports Nutr_. 2014;11:20.
- Helms ER, Zinn C, Rowlands DS, Brown SR. A systematic review of dietary protein during caloric
  restriction in resistance trained lean athletes: a case for higher intakes. _Int J Sport Nutr
  Exerc Metab_. 2014;24(2):127-38.
- Impey SG, Hearris MA, Hammond KM, et al. Fuel for the work required: a theoretical framework for
  carbohydrate periodization and the glycogen threshold hypothesis. _Sports Med_.
  2018;48(5):1031-48.
- Lichtman SW, Pisarska K, Berman ER, et al. Discrepancy between self-reported and actual caloric
  intake and exercise in obese subjects. _N Engl J Med_. 1992;327(27):1893-8.
- Mifflin MD, St Jeor ST, Hill LA, Scott BJ, Daugherty SA, Koh YO. A new predictive equation for
  resting energy expenditure in healthy individuals. _Am J Clin Nutr_. 1990;51(2):241-7.
- Morton RW, Murphy KT, McKellar SR, et al. A systematic review, meta-analysis and
  meta-regression of the effect of protein supplementation on resistance training-induced gains
  in muscle mass and strength in healthy adults. _Br J Sports Med_. 2018;52(6):376-84.
- Shcherbina A, Mattsson CM, Waggott D, et al. Accuracy in wrist-worn, sensor-based measurements
  of heart rate and energy expenditure in a diverse cohort. _J Pers Med_. 2017;7(2):3.
- Thomas DT, Erdman KA, Burke LM. American College of Sports Medicine Joint Position Statement.
  Nutrition and athletic performance. _Med Sci Sports Exerc_. 2016;48(3):543-68.
- Walker J. _The Hacker's Diet_. 1991.
- MacroFactor, centro de ayuda: "Expenditure", "Weight Trend", "How Does MacroFactor Make
  Adjustments For a Weight Gain or Weight Loss Goal?"; y "An Examination of MacroFactor's
  Expenditure Modifiers" (macrofactor.com).
