import { categoryOf, customMetricCode } from '@digitaltwin/clinical';
import { fromLocalDateTime } from '@digitaltwin/nutrition';

export { customMetricCode };

/** Tipo de documento → kind del episodio ('clinical-note': lo que antes era 'other'). */
export const CLINICAL_EPISODES = Object.freeze({
  lab: 'lab',
  holter: 'holter',
  stress_test: 'stress-test',
  ecg: 'ecg',
  imaging: 'imaging',
  other_test: 'medical-test',
  report: 'medical-report',
  other: 'clinical-note',
});

// Las analíticas no traen hora: se colocan a primera hora, cuando se suelen sacar
const LAB_HOUR = '08:00';
const FLAGGED_IN_SUMMARY = 8;

/**
 * Inicio y fin de un documento como instantes. Sin hora (las analíticas), su día a las 08:00.
 * @returns {{ start: Date, end: Date | null }}
 */
export function clinicalPeriod(extraction, timeZone) {
  const startLocal = extraction.start ?? `${extraction.date}T${LAB_HOUR}`;
  return {
    start: fromLocalDateTime(startLocal, timeZone),
    end: extraction.end ? fromLocalDateTime(extraction.end, timeZone) : null,
  };
}

/**
 * Un documento clínico confirmado ({ documentId, fileName, extraction } de @digitaltwin/clinical)
 * → un episodio (analítica, holter, prueba de esfuerzo) con todo el detalle y una observación por
 * cada valor numérico en la unidad de su métrica. La tabla por horas del holter va a heart.rate
 * (la media de cada tramo), así el pulso de esas horas sale aunque no llevaras el reloj.
 */
export function normalizeClinical(payload, { timeZone }) {
  const { documentId, fileName, extraction } = payload;
  const { type } = extraction;
  const origin = `clinical:${type}`;
  const originDetails = { kind: type, center: extraction.center ?? null };
  const { start, end } = clinicalPeriod(extraction, timeZone);
  const time = start.toISOString();

  const observations = [];
  const metrics = {};
  for (const item of extraction.items) {
    if (item.skip || item.metricValue == null || item.issues?.includes('unit')) continue;
    const metric = item.metric ?? customMetricCode(type, item);
    if (!item.metric) {
      metrics[metric] = { unit: item.metricUnit ?? null, aggregation: 'last', label: item.name };
    }
    observations.push({ origin, originDetails, metric, time, value: item.metricValue });
  }
  for (const row of extraction.hourly ?? []) {
    if (row.hrAvg == null) continue;
    observations.push({
      origin,
      originDetails,
      metric: 'heart.rate',
      time: fromLocalDateTime(row.start, timeZone).toISOString(),
      end: fromLocalDateTime(row.end, timeZone).toISOString(),
      value: row.hrAvg,
    });
  }

  const flagged = extraction.items.filter((i) => i.flag);
  return {
    mode: 'exact',
    newMetrics: metrics,
    observations,
    episodes: [
      {
        origin,
        originDetails,
        kind: CLINICAL_EPISODES[type] ?? 'clinical-note',
        externalId: documentId,
        start: time,
        end: end?.toISOString() ?? null,
        title: extraction.title,
        summary: {
          documentId,
          type,
          category: categoryOf(type),
          center: extraction.center ?? null,
          items: extraction.items.length,
          flagged: flagged.length,
          flaggedItems: flagged.slice(0, FLAGGED_IN_SUMMARY).map((i) => ({
            name: i.name,
            text: i.text,
            unit: i.unit,
            flag: i.flag,
          })),
          ...(extraction.report && {
            diagnosis: extraction.report.diagnosis,
            restFrom: extraction.report.restFrom,
            restTo: extraction.report.restTo,
          }),
          // Lo más importante de una prueba (holter, esfuerzo...), para pintarlo sin abrirlo
          ...(type !== 'lab' && {
            measures: Object.fromEntries(
              extraction.items.filter((i) => i.key && i.value != null).map((i) => [i.key, i.value]),
            ),
          }),
        },
        schema: 'clinical@1',
        details: {
          documentId,
          fileName,
          type,
          center: extraction.center ?? null,
          date: extraction.date,
          summary: extraction.summary,
          items: extraction.items.map((i) => ({
            section: i.section,
            name: i.name,
            text: i.text,
            value: i.value,
            unit: i.unit,
            rangeText: i.rangeText,
            rangeMin: i.rangeMin,
            rangeMax: i.rangeMax,
            flag: i.flag,
            comment: i.comment,
            metric: i.skip
              ? null
              : (i.metric ?? (i.metricValue != null ? customMetricCode(type, i) : null)),
            key: i.key,
          })),
          hourly: extraction.hourly ?? [],
          report: extraction.report ?? null,
        },
      },
    ],
  };
}
