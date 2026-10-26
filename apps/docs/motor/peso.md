# Peso real

El peso de la báscula sube y baja cada día por el agua: sal, hidratos, entreno, calor, enfermedad, antiinflamatorios. Un día puede marcar un kilo más sin haber ganado nada de grasa. Comparar dos pesajes no dice nada; **la tendencia sí**.

## Cómo se calcula

**1. Huecos.** Los días sin pesaje se rellenan en línea recta entre el anterior y el siguiente (como MacroFactor), **si el hueco es de 7 días o menos**. Unir pesajes de hace semanas inventaría una tendencia: tras un hueco largo, la tendencia vuelve a arrancar.

**2. Tendencia.** Media móvil exponencial: cada día, la tendencia se acerca un **10 %** al peso del día (como _The Hacker's Diet_).

```
tendencia(hoy) = tendencia(ayer) + 0,10 × (peso(hoy) − tendencia(ayer))
```

Un pico de agua de +1 kg mueve la tendencia solo 0,1 kg; si el cambio se mantiene días, la tendencia lo va recogiendo.

**3. Arranque.** En la **mediana de los primeros 5 pesajes**. Si arrancara en el primero, un primer pesaje raro sesgaría la tendencia durante semanas.

## Creatina

La creatina mete agua en el músculo: al empezar, el peso sube **1-2 kg en 3-4 semanas** (sin fase de carga), y al dejarla baja lo mismo. No es grasa.

El motor **no lo corrige**: la tendencia lo recoge como cualquier cambio que se mantiene, y el gasto se sigue calculando igual. Lo que hace es **avisar** durante 4 semanas desde que la empiezas o la dejas (las fechas de Ajustes → Cuenta → Suplementos): en Hoy, en el informe de la mañana y al coach, para que nadie lea esa subida como grasa ni recorte comida por ella. Dejarla después de tomarla menos de una semana no avisa (no llegó a cargar agua).

## Ejemplo

Con la tendencia en 81,70 kg el domingo:

| Día       | Báscula         | Tendencia |
| --------- | --------------- | --------- |
| Lunes     | 81,8            | 81,71     |
| Martes    | 81,6            | 81,70     |
| Miércoles | 82,2            | 81,75     |
| Jueves    | 81,8            | 81,75     |
| Viernes   | **82,7** (agua) | 81,85     |

El viernes la báscula "sube" casi un kilo; tu peso real, 0,09 kg.
