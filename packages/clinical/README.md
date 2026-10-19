# @digitaltwin/clinical

Informes médicos en PDF (analíticas, holter, prueba de esfuerzo) → valores revisables para el
timeline. Solo el texto sin datos personales sale de la máquina.

```js
import { ClinicalExtractor, processPdf, refreshExtraction } from '@digitaltwin/clinical';

const extractor = new ClinicalExtractor({ apiKey: process.env.LLM_API_KEY });
const { text, redactions, extraction } = await processPdf({ data: pdf, extractor, names: ['Juan'] });
// extraction: { type, title, date, start, end, summary, items: [{ name, text, value, unit, rangeMin,
//   rangeMax, flag, metric, metricValue, metricUnit, issues }], hourly, issues }
const edited = refreshExtraction({ ...extraction, items: [...] }, text); // tras corregir a mano
```

1. `extractPdfText`: `pdftotext -layout` (poppler-utils). Un PDF escaneado da `NO_TEXT`.
2. `redactPersonalData`: reglas deterministas (cabecera del paciente, etiquetas, DNI, teléfonos...).
3. `ClinicalExtractor`: DeepSeek en modo JSON, a temperatura 0.
4. `buildExtraction` / `refreshExtraction`: cada valor se comprueba contra el texto (`unverified`
   si no está), se asigna su métrica (`ANALYTES`, con LOINC) y se convierte a su unidad.

`createDbClinicalStore` guarda los documentos (migración `0011_clinical` de `@digitaltwin/db`).
