# MCP: tu IA con tus datos

TwinMe tiene un servidor **MCP** (Model Context Protocol): conecta Claude (Code o Desktop) u otra IA compatible y podrá consultar tus datos con las mismas herramientas que el coach. Solo los tuyos, y de solo lectura, salvo una cosa: si tienes conectada la app de fuerza, también puede [prepararte sesiones como plantillas](#plantillas-de-fuerza).

## Conectar

1. En **Ajustes → Cuenta → Acceso para tu IA (MCP)**, crea un **token personal** con un nombre (por ejemplo "Claude Code"). Empieza por `dt_` y se enseña una sola vez: cópialo. Desde ahí ves cuándo se usó cada uno y lo puedes revocar.
2. Añade el servidor:

**Claude Code**

```bash
claude mcp add --transport http twinme https://twinme.app/api/mcp \
  --header "Authorization: Bearer dt_TU_TOKEN"
```

**Claude Desktop** (con `mcp-remote`), en `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "twinme": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://twinme.app/api/mcp",
        "--header",
        "Authorization: Bearer dt_TU_TOKEN"
      ]
    }
  }
}
```

El endpoint es `POST /api/mcp` (HTTP "streamable", sin estado, respuestas JSON).

## Herramientas

| Herramienta         | Qué da                                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_profile`       | Edad, sexo, altura y peso objetivo                                                                                                                   |
| `get_engine`        | El [motor](/motor/): peso real, gasto real (con confianza), objetivos, aviso de desajuste, aviso de la creatina y el historial día a día             |
| `list_metrics`      | Las métricas con datos (código, unidad, cómo se agregan y desde cuándo)                                                                              |
| `get_series`        | Series por día o por hora de varias métricas                                                                                                         |
| `get_day_summary`   | Resumen de un día                                                                                                                                    |
| `get_episodes`      | Comidas, entrenos, sueño, pesajes, agua y café, síntomas, notas, medicación, suplementos y pruebas médicas (hasta 31 días; detalle completo hasta 3) |
| `get_strength_sets` | Entrenos de fuerza con todas sus series ("8x70" = 8 reps con 70 kg), hasta 92 días, filtrable por ejercicio                                          |
| `get_observations`  | Datos crudos de una métrica (hasta 2 días, 500 puntos) para hacer zoom                                                                               |

El usuario sale del token, nunca de los argumentos: una IA no puede pedir datos de otra persona. Las salidas son pequeñas a propósito (agregados y límites), para no gastar tokens.

## Plantillas de fuerza

Si tienes conectada **Fuerza (experimental)**, tu IA puede prepararte sesiones de gimnasio y dejarlas en tu app de fuerza como **plantillas**, listas para entrenar. Las tuyas las puede leer, pero no tocarlas: solo crea, reescribe y borra las suyas, que llevan el chip naranja **TwinMe**.

| Herramienta                | Qué hace                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `list_strength_templates`  | Tus plantillas (nombre, ejercicios, series, duración, músculos) y cuáles son de TwinMe                   |
| `get_strength_template`    | Una plantilla serie a serie ("8x70", "45s") con el descanso medio                                        |
| `search_exercises`         | Busca en el catálogo de ejercicios de la app (en inglés o español, por músculo o material)               |
| `save_strength_template`   | Crea una plantilla o reescribe entera una de TwinMe (ejercicios en orden, reps, kilos, tiempo, descanso) |
| `delete_strength_template` | Borra una de TwinMe                                                                                      |

- **Antes de guardar, te la enseña** y espera a que digas que sí. Las dos que escriben van marcadas como no de solo lectura, así que tu cliente (Claude Code, Desktop) también te pide permiso.
- **Con el plan gratis de la app caben 2 plantillas.** Lo práctico es dejar una para TwinMe e ir reescribiéndola con la sesión que toque. Si las dos son tuyas, tu IA no borra ninguna: te pide que liberes una.
- Una plantilla borrada no se recupera con el mismo id; si la vuelves a crear, es otra.
- Es una integración no oficial: si la app cambia algo, estas herramientas pueden fallar sin tocar tus datos de TwinMe.
