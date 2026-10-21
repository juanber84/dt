# Del dato al timeline

```
 fuente ─► buzón (inbox) ─► dato en bruto (raw_records) ─► normalizador ─► observaciones + episodios
                                                                             │
                                          agregados por hora (TimescaleDB) ◄─┘ ─► consultas ─► app · coach · motor
```

1. **Buzón**: todo lo que llega de fuera (webhooks, bot) se guarda tal cual, para auditar y reprocesar.
2. **Bruto**: lo que dijo cada fuente, intacto, por lote (un día de FC de Google = un registro), con su identificador para que reimportar no duplique. Si no ha cambiado, no se vuelve a procesar.
3. **Normalizador** (uno por fuente y tipo): lo convierte en **observaciones** (medidas numéricas en una hypertable estrecha) y **episodios** (cosas con inicio y fin: comida, entreno, noche, pesaje, síntoma, toma…). Un dato borrado en origen se marca y su normalización lo deja vacío.
4. **Agregados por hora**: media, mínimo, máximo, suma y nº de muestras por hora y por origen, refrescados cada 2 minutos. Sobre ellos se elige el valor canónico (ver [Cómo se combinan](/datos/combinar)).
5. **Consultas**: series por día u hora en tu zona horaria, episodios y datos crudos.
