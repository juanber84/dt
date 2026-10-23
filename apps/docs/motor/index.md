# El motor

El motor calcula los números que importan para bajar grasa y rendir: tu **peso real**, lo que **gastas de verdad** y lo que te **toca comer**. Es código con modelos sencillos y comprobables, sin IA: con los mismos datos da siempre lo mismo, y tiene tests. El coach explica sus números; no calcula otros.

```
 comida apuntada ─┐
                  ├─► peso real ─┐
 báscula ─────────┘              ├─► gasto real ─► objetivos de comida ─► Hoy · Tendencias · coach
 pasos ──────────► punto de partida ─┘
 perfil (edad, sexo, altura, ritmo) ───────────────┘
```

## Por qué así

- **Los relojes fallan mucho estimando energía.** En un estudio con 7 dispositivos de muñeca, ninguno bajó del 20 % de error en el gasto, y algunos pasaron del 90 % (Shcherbina et al., 2017). Con ese error no se puede llevar un déficit.
- **Lo que comemos se apunta de menos.** Sin querer: raciones a ojo, aceite, salsas, picoteo. En personas que "no bajaban comiendo poco", lo apuntado era un 47 % menos que lo comido (Lichtman et al., 1992).
- **La báscula no miente a medio plazo.** Su tendencia dice si estás en déficit. Comparando lo que apuntas con lo que hace tu peso se saca tu gasto "efectivo", y el error de apuntar queda absorbido.

Es el método que hizo famosa a **MacroFactor**. Seguimos lo que publican de él (los pesos exactos de su algoritmo no son públicos) y la literatura científica.

## Las piezas

1. [Peso real](/motor/peso): la tendencia, sin el ruido del agua.
2. [Gasto real](/motor/gasto): adaptativo, aprende de tus días apuntados.
3. [Objetivos de comida](/motor/objetivos): kcal y macros para tu ritmo.
4. [Periodos](/motor/periodos): fuera de casa o enfermo, para que no aprenda mal.
5. [Límites y siguiente](/motor/siguiente): lo que aún no hace y lo que viene.
6. [Referencias](/motor/referencias).

## Dónde se ve

- **Hoy → Nutrición**: tus objetivos de kcal, proteína, hidratos y grasa.
- **Tendencias → Peso real y gasto**.
- **Coach**: lo recibe en cada respuesta.
- **API** `GET /api/v1/engine` y **MCP** `get_engine`, con el historial día a día.
