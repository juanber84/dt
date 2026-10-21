# Trabajos y avisos

El worker procesa la cola (pg-boss, sobre la misma base de datos). Cada trabajo tiene sus reintentos y su política.

| Trabajo              | Qué hace                                             | Cuándo                                                        |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| `sync`               | Trae lo nuevo de una conexión                        | Al pedirlo, por aviso o por cron                              |
| `backfill` · `fetch` | Carga inicial por trozos · descarga de un trozo      | Al conectar · lo planifica `sync`                             |
| `normalize`          | Bruto → timeline                                     | Cuando llega o cambia un dato                                 |
| `scheduled-sync`     | Un `sync` por conexión                               | Xiaomi cada 30 min, Google cada hora, intervals.icu cada hora |
| `clinical-extract`   | Leer un informe                                      | Al subirlo                                                    |
| `push`               | Mandar un aviso (o aplazarlo a después del silencio) | Al haber algo que avisar                                      |
| `push-rules`         | Reglas de avisos (comidas sin apuntar)               | 16:00                                                         |
| `google-subscriber`  | Mantener el suscriptor de webhooks de Google         | Al arrancar y a diario                                        |
| `db-backup`          | Copia cifrada de la base de datos a Google Drive     | 04:00                                                         |
| `maintenance`        | Limpieza (buzón de más de 30 días, contadores)       | 03:30                                                         |

Los límites de cada API de fuera se respetan con un limitador compartido; si una pide esperar, el trabajo se aplaza (no cuenta como fallo). El estado se ve en **Ajustes → Sistema**.
