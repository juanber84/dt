# MCP: tu IA con tus datos

Digital Twin tiene un servidor **MCP** (Model Context Protocol): conecta Claude (Code o Desktop) u otra IA compatible y podrá consultar tus datos con las mismas herramientas que el coach. Solo lectura, y solo los tuyos.

## Conectar

1. En **Ajustes → Cuenta → Acceso para tu IA (MCP)**, crea un **token personal** con un nombre (por ejemplo "Claude Code"). Empieza por `dt_` y se enseña una sola vez: cópialo. Desde ahí ves cuándo se usó cada uno y lo puedes revocar.
2. Añade el servidor:

**Claude Code**

```bash
claude mcp add --transport http digitaltwin https://dt.cadenceai.ovh/api/mcp \
  --header "Authorization: Bearer dt_TU_TOKEN"
```

**Claude Desktop** (con `mcp-remote`), en `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "digitaltwin": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://dt.cadenceai.ovh/api/mcp",
        "--header",
        "Authorization: Bearer dt_TU_TOKEN"
      ]
    }
  }
}
```

El endpoint es `POST /api/mcp` (HTTP "streamable", sin estado, respuestas JSON).

## Herramientas

| Herramienta         | Qué da                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `get_profile`       | Edad, sexo, altura y peso objetivo                                                                                                      |
| `get_engine`        | El [motor](/motor/): peso real, gasto real (con confianza), objetivos, aviso de desajuste y el historial día a día                      |
| `list_metrics`      | Las métricas con datos (código, unidad, cómo se agregan y desde cuándo)                                                                 |
| `get_series`        | Series por día o por hora de varias métricas                                                                                            |
| `get_day_summary`   | Resumen de un día                                                                                                                       |
| `get_episodes`      | Comidas, entrenos, sueño, pesajes, agua y café, síntomas, notas, medicación y pruebas médicas (hasta 31 días; detalle completo hasta 3) |
| `get_strength_sets` | Entrenos de fuerza de Motra con todas sus series ("8x70" = 8 reps con 70 kg), hasta 92 días, filtrable por ejercicio                    |
| `get_observations`  | Datos crudos de una métrica (hasta 2 días, 500 puntos) para hacer zoom                                                                  |

El usuario sale del token, nunca de los argumentos: una IA no puede pedir datos de otra persona. Las salidas son pequeñas a propósito (agregados y límites), para no gastar tokens.
