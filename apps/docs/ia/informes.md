# Lectura de informes

Cómo se lee un PDF médico (analítica, holter, prueba de esfuerzo, ECG, imagen, informe).

1. **Texto**: se extrae con `pdftotext`; si es un escaneo, se pasa a imagen y se lee con OCR (Tesseract, en español).
2. **Sin datos personales**: antes de salir del servidor se quitan nombre, DNI, dirección, teléfonos, números de historia… de forma determinista (sin IA).
3. **Extracción**: la IA devuelve un JSON validado con esquema: tipo, fecha, y cada valor con su unidad y su rango; o las medidas de la prueba y la conclusión; o el diagnóstico, las recomendaciones y el reposo de un informe.
4. **Comprobación**: cada valor tiene que aparecer en el texto del PDF; lo que no, se marca para revisar.
5. **Catálogo**: los parámetros se reconocen con un catálogo propio (con códigos LOINC) y las unidades se convierten a las de referencia. Los nombres raros de tu laboratorio se aprenden al confirmarlos.
6. **Revisión**: nada entra en tu historial hasta que lo confirmas.

Cuesta unos céntimos de céntimo por informe; si la IA falla, se reintenta y, si no, queda en error explicándolo.
