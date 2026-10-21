# Cómo se combinan

## Se guarda todo, en bruto

Cada dato se guarda tal como lo dice su fuente, con su origen y su identificador, aunque otra fuente diga lo mismo. Así se puede cambiar el criterio sin perder nada y comparar fuentes.

## Cuál manda

Cuando varias fuentes miden lo mismo en la misma hora, el valor "canónico" se elige por este orden:

1. **Prioridad de la fuente** (configurable en Ajustes → Fuentes).
2. **Prioridad del origen dentro de la fuente**: dentro de Google, el Apple Watch manda (lo llevas puesto día y noche).
3. **La que tenga más muestras**.

Las comidas: si el bot apuntó comidas un día, se usan esas y se ocultan las que llegan de Google ese día (siguen guardadas).

## Apple Watch + iPhone: sin contar dos veces

Google manda a la vez los pasos (y distancia y kcal) del reloj y del iPhone. Sumarlos contaría dos veces lo andado. Digital Twin hace lo mismo que la app Salud:

- El **reloj manda**; el iPhone solo cuenta en los ratos que el reloj no cubre.
- Los huecos entre muestras del reloj de **menos de 15 minutos** cuentan como cubiertos (el reloj registra a trozos aunque lo lleves).

Ajustado con los totales de Salud (19/10/2026: reloj 7.442 pasos, Salud ~7.400).

## Por hora y por día

Las medidas se agregan por hora (media, mínimo, máximo, suma, nº de muestras) y por día según su tipo: los pasos y las kcal se suman; el peso y la FC se promedian; la FC en reposo o el VO2 máx. toman el último valor.
