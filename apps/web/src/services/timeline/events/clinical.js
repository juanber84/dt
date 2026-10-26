/** Informes médicos (Clínica) como eventos del día: los episodios y los documentos. */
import { minutesOfDay, parseISODate, toISODate } from '../../../lib/dates.js';
import { CLINICAL_KIND_OF_TYPE } from '../kinds.js';

const CLINICAL_ICON = {
  lab: 'FlaskConical',
  holter: 'HeartPulse',
  'stress-test': 'Gauge',
  ecg: 'Activity',
  imaging: 'ScanLine',
  'medical-test': 'Stethoscope',
  'medical-report': 'ClipboardList',
  'clinical-note': 'FileText',
};
// Lo que se enseña de un holter o una prueba de esfuerzo (summary.measures)
const CLINICAL_MEASURES = [
  ['hr_min', 'FC mín.', 'ppm'],
  ['hr_avg', 'FC media', 'ppm'],
  ['hr_max', 'FC máx.', 'ppm'],
  ['sdnn', 'SDNN', 'ms'],
  ['vo2max', 'VO2max', 'mL/kg/min', 1],
  ['vt1_hr', 'VT1', 'ppm'],
  ['vt2_hr', 'VT2', 'ppm'],
  ['max_power', 'Potencia máx.', 'W'],
  ['pr_ms', 'PR', 'ms'],
  ['qrs_ms', 'QRS', 'ms'],
  ['qtc_ms', 'QTc', 'ms'],
];
const shortDate = (iso) =>
  new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })
    .format(parseISODate(iso))
    .replace('.', '');
const FLAG = { high: '↑', low: '↓', abnormal: '!' };

/**
 * Un informe médico en el día: lo fuera de rango (analíticas), sus medidas (pruebas) o el
 * diagnóstico (informes). Al pincharlo se abre el documento en el lateral (`clinical`).
 */
export function clinicalEvent(episode) {
  const s = episode.summary ?? {};
  const start = minutesOfDay(new Date(episode.start));
  const decimals = (text) => (String(text).split(/[.,]/)[1] ?? '').length;
  const flagged = (s.flaggedItems ?? [])
    .map((i) => ({
      label: `${FLAG[i.flag] ?? ''} ${i.name}`.trim(),
      value: Number(String(i.text).replace(',', '.')),
      unit: i.unit ?? undefined,
      digits: decimals(i.text),
    }))
    .filter((m) => Number.isFinite(m.value));
  const measures = CLINICAL_MEASURES.filter(([key]) => s.measures?.[key] != null).map(
    ([key, label, unit, digits]) => ({ label, value: s.measures[key], unit, digits }),
  );
  const parts =
    episode.kind === 'lab'
      ? [
          s.items && `${s.items} valores`,
          s.flagged ? `${s.flagged} fuera de rango` : 'todo en rango',
        ]
      : episode.kind === 'medical-report'
        ? [s.diagnosis, s.restTo && `reposo hasta el ${shortDate(s.restTo)}`]
        : [s.center];
  return {
    // Mismo id para el documento antes y después de confirmarlo (y para enlazarlo desde Clínica)
    id: s.documentId ? `clinical-${s.documentId}` : episode.id,
    category: 'clinical',
    icon: CLINICAL_ICON[episode.kind] ?? 'FileText',
    title: episode.title,
    subtitle: parts.filter(Boolean).join(' · '),
    start,
    end: episode.end
      ? start + Math.round((new Date(episode.end) - new Date(episode.start)) / 60_000)
      : undefined,
    metrics: episode.kind === 'lab' ? flagged : measures,
    ...(s.documentId && { clinical: { documentId: s.documentId, status: 'confirmed' } }),
    sources: [
      {
        source: 'clinical',
        primary: true,
        externalId: s.documentId ?? episode.id,
        recordedAt: episode.start,
        values: {
          ...(s.center && { centro: s.center }),
          ...(s.items != null && { valores: s.items }),
          ...(s.flagged != null && { 'fuera de rango': s.flagged }),
        },
      },
    ],
  };
}

/** El día en que va un documento: el de la prueba, el de la subida o el de creación. */
export function documentDay(doc) {
  return doc.date ?? doc.requestedDate ?? toISODate(new Date(doc.createdAt));
}

const PENDING_SUBTITLE = {
  processing: 'Leyendo el informe…',
  review: 'Por revisar: confirma lo leído',
  error: 'No se ha podido leer',
};
// Las analíticas no traen hora: a primera hora, como en la API
const DOCUMENT_HOUR = 8 * 60;

/**
 * Un documento de Clínica (de GET /clinical/documents) como evento del día, esté como esté: los
 * que faltan por revisar también salen, para revisarlos desde ahí. `day` es el día en que va.
 */
export function documentEvent(doc, day = documentDay(doc)) {
  // start/end son hora local sin zona ("2026-09-30T13:30"): new Date las lee en local
  const start = doc.start ? new Date(doc.start) : null;
  const end = doc.end ? new Date(doc.end) : null;
  const created = new Date(doc.createdAt);
  // Sin hora: la de subida si se subió ese mismo día y aún no se ha leído; si no, las 08:00
  let at = start;
  if (!at) {
    const minutes = !doc.date && toISODate(created) === day ? minutesOfDay(created) : DOCUMENT_HOUR;
    at = parseISODate(day);
    at.setHours(Math.floor(minutes / 60), minutes % 60);
  }
  const event = clinicalEvent({
    id: `clinical-${doc.id}`,
    kind: CLINICAL_KIND_OF_TYPE[doc.type] ?? 'clinical-note',
    title: doc.title ?? (doc.status === 'processing' ? 'Informe' : doc.fileName),
    start: at.toISOString(),
    end: start && end ? end.toISOString() : null,
    summary: {
      documentId: doc.id,
      center: doc.center,
      items: doc.counts?.items,
      flagged: doc.counts?.flagged,
      flaggedItems: doc.flaggedItems,
      measures: doc.measures,
      diagnosis: doc.diagnosis,
      restTo: doc.restTo,
    },
  });
  if (doc.status === 'confirmed') return event;
  return {
    ...event,
    icon: doc.status === 'processing' ? 'FileText' : event.icon,
    subtitle: PENDING_SUBTITLE[doc.status] ?? event.subtitle,
    metrics: doc.status === 'review' ? event.metrics : [],
    clinical: { documentId: doc.id, status: doc.status },
  };
}

/**
 * Los eventos de Clínica del día salen de los documentos (así se ven también los pendientes y no
 * hay que esperar a que se normalice al confirmar): fuera los episodios de esos documentos.
 */
export function withDocuments(events, documents, day) {
  const mine = documents.filter((d) => documentDay(d) === day);
  const ids = new Set(documents.map((d) => `clinical-${d.id}`));
  return [...events.filter((e) => !ids.has(e.id)), ...mine.map((d) => documentEvent(d, day))].sort(
    (a, b) => a.start - b.start,
  );
}
