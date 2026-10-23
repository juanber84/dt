# Periodos: fuera de casa o enfermo

Unas vacaciones, un puente o una gripe despistan al motor: comes distinto, lo apuntas a medias y el peso viene con agua y sal. Si no se lo dices, aprende mal. Por ejemplo, con un puente apuntado a medias cree que gastas menos de lo real y te baja el objetivo sin motivo.

Por eso se apunta un **periodo** en **Registrar → Periodo**: el tipo (**fuera de casa**, **enfermo** u **otro**), desde qué día y hasta qué día (los dos incluidos). Se puede apuntar antes de irte.

## Qué cambia

|                        | Durante el periodo                                                                                                                | Los 3 días después                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Gasto**              | No aprende: ni lo comido ni el peso son los de siempre                                                                            | Tampoco: el peso aún trae agua                                        |
| **Tendencia del peso** | Fuera de casa, los pesajes no entran (otra báscula marca distinto) y se mantiene en el último de casa. Enfermo, cuentan un tercio | Los pesajes cuentan un tercio: el salto de la vuelta casi no la mueve |
| **Objetivo**           | Mantenimiento: no es momento de déficit                                                                                           | El normal                                                             |

Además:

- **Hoy** enseña una franja: "Fuera de casa · del 1 al 4 de noviembre" o "Has vuelto hace 1 día".
- El **coach** y el **informe de la mañana** lo saben: no te reprochan no pesarte ni no apuntar, y al volver te explican que el salto es agua.
- No llega el aviso de **comidas sin apuntar** esos días.

## Mientras estás fuera

- **No te peses en otra báscula**: no entra, y solo te liará.
- **O apuntas el día entero (aunque sea a ojo) o nada.** Lo que despista es el día a medias. Con el periodo marcado da igual para el gasto, pero para el coach y para ti es mejor así.
- **Al volver, normal**: pésate como siempre y no recortes para compensar. En 3-5 días se va el agua y la tendencia sigue donde estaba.

## Detalles

- Un periodo dura como mucho 90 días.
- Si vuelves antes, bórralo desde su detalle en el timeline (sale el día que empieza) y apúntalo otra vez con la fecha buena.
- Los pesajes de los 3 días después cuentan un tercio (`DOUBTFUL_WEIGHT`) y una semana de cálculo del gasto que toque un periodo se salta entera (`SETTLING_DAYS` = 3). Código en `packages/engine` (`markPeriods`, `weightTrend`, `predictExpenditure`).
