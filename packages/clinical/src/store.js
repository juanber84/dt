import { createHash, randomUUID } from 'node:crypto';
import { normalizeName } from './analytes.js';
import { categoryOf } from './schema.js';

export const DocumentStatus = Object.freeze({
  PROCESSING: 'processing',
  REVIEW: 'review',
  CONFIRMED: 'confirmed',
  ERROR: 'error',
});

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// Los fuera de rango que van en la lista (para pintarlos en el día sin abrir el documento)
const FLAGGED_IN_SUMMARY = 8;

/** Lo que se enseña de un documento en la lista (sin el PDF ni el texto). */
function summaryOf(doc) {
  const extraction = doc.extraction;
  const items = extraction?.items ?? [];
  const flagged = items.filter((i) => i.flag);
  return {
    id: doc.id,
    status: doc.status,
    type: doc.type,
    category: doc.type ? categoryOf(doc.type) : null,
    title: extraction?.title ?? null,
    center: extraction?.center ?? null,
    date: doc.date,
    /** El día desde el que se subió (si el informe trae otra fecha, manda la del informe). */
    requestedDate: doc.requestedDate,
    start: extraction?.start ?? null,
    end: extraction?.end ?? null,
    diagnosis: extraction?.report?.diagnosis ?? null,
    restTo: extraction?.report?.restTo ?? null,
    flaggedItems: flagged.slice(0, FLAGGED_IN_SUMMARY).map((i) => ({
      name: i.name,
      text: i.text,
      unit: i.unit,
      flag: i.flag,
    })),
    measures: Object.fromEntries(
      items.filter((i) => i.key && i.value != null).map((i) => [i.key, i.value]),
    ),
    fileName: doc.fileName,
    sizeBytes: doc.sizeBytes,
    error: doc.error,
    counts: {
      items: items.length,
      flagged: flagged.length,
      issues: items.filter((i) => i.issues?.some((x) => x !== 'qualitative')).length,
    },
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    confirmedAt: doc.confirmedAt,
  };
}

/** Detalle: lo de la lista más la extracción y el texto que vio el modelo. */
function detailOf(doc) {
  return {
    ...summaryOf(doc),
    redactions: doc.redactions,
    extraction: doc.extraction,
    text: doc.text,
  };
}

const fromRow = (row) => ({
  id: row.id,
  userId: row.user_id,
  status: row.status,
  type: row.type,
  fileName: row.file_name,
  sizeBytes: row.size_bytes,
  sha256: row.sha256,
  text: row.text,
  redactions: row.redactions,
  extraction: row.extraction,
  error: row.error,
  date: row.document_date ? isoDate(row.document_date) : null,
  requestedDate: row.requested_date ? isoDate(row.requested_date) : null,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  confirmedAt: row.confirmed_at?.toISOString() ?? null,
});

// `date` llega como Date a medianoche UTC
const isoDate = (value) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

/**
 * Documentos clínicos en la BD (migración 0011). Todo lo del usuario va por userId: nadie lee ni
 * toca un documento ajeno. Lo que usa el worker (`claim`, `saveExtraction`, `fail`) va por id.
 * @param {{ db: import('postgres').Sql }} deps
 */
export function createDbClinicalStore({ db }) {
  // Fragmento con las columnas de siempre (sin el PDF): se crea en cada consulta
  const columns = () => db`
    id, user_id, status, type, file_name, size_bytes, sha256, text, redactions, extraction, error,
    document_date, requested_date, created_at, updated_at, confirmed_at
  `;
  return {
    /**
     * Guarda un PDF nuevo (estado processing). Si ya estaba (mismo contenido) devuelve ese.
     * `requestedDate`: el día desde el que se sube (YYYY-MM-DD), por si el informe no trae fecha.
     * @returns {Promise<{ document: object, created: boolean }>}
     */
    async create({ userId, fileName, data, requestedDate = null }) {
      const hash = sha256(data);
      const [row] = await db`
        insert into clinical_documents
          (user_id, file_name, size_bytes, sha256, content, requested_date)
        values
          (${userId}, ${fileName}, ${data.length}, ${hash}, ${Buffer.from(data)}, ${requestedDate})
        on conflict (user_id, sha256) do nothing
        returning ${columns()}
      `;
      if (row) return { document: summaryOf(fromRow(row)), created: true };
      const [existing] = await db`
        select ${columns()} from clinical_documents where user_id = ${userId} and sha256 = ${hash}
      `;
      return { document: summaryOf(fromRow(existing)), created: false };
    },

    async list(userId) {
      const rows = await db`
        select ${columns()} from clinical_documents where user_id = ${userId}
        order by coalesce(document_date, created_at::date) desc, created_at desc
      `;
      return rows.map((row) => summaryOf(fromRow(row)));
    },

    async get(userId, id) {
      const [row] = await db`
        select ${columns()} from clinical_documents where id = ${id} and user_id = ${userId}
      `;
      return row ? detailOf(fromRow(row)) : null;
    },

    /** Para el worker: el documento con su PDF, y lo pone en processing. */
    async claim(id) {
      const [row] = await db`
        update clinical_documents set status = 'processing', error = null, updated_at = now()
        where id = ${id}
        returning ${columns()}, content
      `;
      return row ? { ...fromRow(row), data: row.content } : null;
    },

    async saveExtraction(id, { text, redactions, extraction }) {
      await db`
        update clinical_documents set
          status = 'review', type = ${extraction.type}, text = ${text}, redactions = ${redactions},
          extraction = ${db.json(extraction)}, document_date = ${extraction.date}, error = null,
          updated_at = now()
        where id = ${id}
      `;
    },

    async fail(id, message) {
      await db`
        update clinical_documents set status = 'error', error = ${message}, updated_at = now()
        where id = ${id}
      `;
    },

    /** Lo editado en la revisión. Si ya estaba confirmado, vuelve a revisión hasta confirmarlo. */
    async updateExtraction(userId, id, extraction) {
      const [row] = await db`
        update clinical_documents set
          extraction = ${db.json(extraction)}, type = ${extraction.type},
          document_date = ${extraction.date},
          status = case when status = 'confirmed' then 'review' else status end,
          updated_at = now()
        where id = ${id} and user_id = ${userId} and status in ('review', 'confirmed')
        returning ${columns()}
      `;
      return row ? detailOf(fromRow(row)) : null;
    },

    async confirm(userId, id) {
      const [row] = await db`
        update clinical_documents set status = 'confirmed', confirmed_at = now(), updated_at = now()
        where id = ${id} and user_id = ${userId} and status in ('review', 'confirmed')
        returning ${columns()}
      `;
      return row ? detailOf(fromRow(row)) : null;
    },

    async remove(userId, id) {
      const [row] = await db`
        delete from clinical_documents where id = ${id} and user_id = ${userId}
        returning ${columns()}
      `;
      return row ? summaryOf(fromRow(row)) : null;
    },

    /** Documentos confirmados con su extracción (para los parámetros). */
    async confirmed(userId) {
      const rows = await db`
        select ${columns()} from clinical_documents
        where user_id = ${userId} and status = 'confirmed'
        order by document_date
      `;
      return rows.map((row) => detailOf(fromRow(row)));
    },

    /** Nombre normalizado → métrica, de los que ha confirmado el usuario. */
    async aliases(userId) {
      const rows =
        await db`select alias, metric_code from clinical_aliases where user_id = ${userId}`;
      return new Map(rows.map((r) => [r.alias, r.metric_code]));
    },

    /** @param {[string, string][]} pairs  [nombre como sale en el informe, métrica] */
    async saveAliases(userId, pairs) {
      for (const [name, code] of pairs) {
        await db`
          insert into clinical_aliases (user_id, alias, metric_code)
          values (${userId}, ${normalizeName(name)}, ${code})
          on conflict (user_id, alias) do update set metric_code = excluded.metric_code
        `;
      }
    },

    /** Nombre del usuario (para quitarlo del texto). */
    async userNames(userId) {
      const [row] = await db`select name, email from users where id = ${userId}`;
      return row ? [row.name, row.email?.split('@')[0]].filter(Boolean) : [];
    },
  };
}

/** Lo mismo en memoria (tests y arranque sin BD). */
export function createMemoryClinicalStore({ users = new Map() } = {}) {
  const docs = new Map();
  const aliasesByUser = new Map();
  const mine = (userId, id) => {
    const doc = docs.get(id);
    return doc?.userId === userId ? doc : null;
  };
  const touch = (doc) => {
    doc.updatedAt = new Date(Math.max(Date.now(), Date.parse(doc.updatedAt) + 1)).toISOString();
  };

  return {
    async create({ userId, fileName, data, requestedDate = null }) {
      const hash = sha256(data);
      const existing = [...docs.values()].find((d) => d.userId === userId && d.sha256 === hash);
      if (existing) return { document: summaryOf(existing), created: false };
      const now = new Date().toISOString();
      const doc = {
        id: randomUUID(),
        userId,
        status: DocumentStatus.PROCESSING,
        type: null,
        fileName,
        sizeBytes: data.length,
        sha256: hash,
        data: Buffer.from(data),
        text: null,
        redactions: null,
        extraction: null,
        error: null,
        date: null,
        requestedDate,
        createdAt: now,
        updatedAt: now,
        confirmedAt: null,
      };
      docs.set(doc.id, doc);
      return { document: summaryOf(doc), created: true };
    },

    async list(userId) {
      return [...docs.values()]
        .filter((d) => d.userId === userId)
        .sort(
          (a, b) =>
            (b.date ?? b.createdAt.slice(0, 10)).localeCompare(
              a.date ?? a.createdAt.slice(0, 10),
            ) || b.createdAt.localeCompare(a.createdAt),
        )
        .map(summaryOf);
    },

    async get(userId, id) {
      const doc = mine(userId, id);
      return doc ? structuredClone(detailOf(doc)) : null;
    },

    async claim(id) {
      const doc = docs.get(id);
      if (!doc) return null;
      Object.assign(doc, { status: DocumentStatus.PROCESSING, error: null });
      touch(doc);
      return { ...structuredClone({ ...doc, data: undefined }), data: doc.data };
    },

    async saveExtraction(id, { text, redactions, extraction }) {
      const doc = docs.get(id);
      Object.assign(doc, {
        status: DocumentStatus.REVIEW,
        type: extraction.type,
        text,
        redactions,
        extraction: structuredClone(extraction),
        date: extraction.date,
        error: null,
      });
      touch(doc);
    },

    async fail(id, message) {
      const doc = docs.get(id);
      if (!doc) return;
      Object.assign(doc, { status: DocumentStatus.ERROR, error: message });
      touch(doc);
    },

    async updateExtraction(userId, id, extraction) {
      const doc = mine(userId, id);
      if (!doc || ![DocumentStatus.REVIEW, DocumentStatus.CONFIRMED].includes(doc.status))
        return null;
      Object.assign(doc, {
        extraction: structuredClone(extraction),
        type: extraction.type,
        date: extraction.date,
        status: DocumentStatus.REVIEW,
      });
      touch(doc);
      return structuredClone(detailOf(doc));
    },

    async confirm(userId, id) {
      const doc = mine(userId, id);
      if (!doc || ![DocumentStatus.REVIEW, DocumentStatus.CONFIRMED].includes(doc.status))
        return null;
      Object.assign(doc, {
        status: DocumentStatus.CONFIRMED,
        confirmedAt: new Date().toISOString(),
      });
      touch(doc);
      return structuredClone(detailOf(doc));
    },

    async remove(userId, id) {
      const doc = mine(userId, id);
      if (!doc) return null;
      docs.delete(id);
      return summaryOf(doc);
    },

    async confirmed(userId) {
      return [...docs.values()]
        .filter((d) => d.userId === userId && d.status === DocumentStatus.CONFIRMED)
        .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
        .map((d) => structuredClone(detailOf(d)));
    },

    async aliases(userId) {
      return new Map(aliasesByUser.get(userId) ?? []);
    },

    async saveAliases(userId, pairs) {
      const map = aliasesByUser.get(userId) ?? new Map();
      for (const [name, code] of pairs) map.set(normalizeName(name), code);
      aliasesByUser.set(userId, map);
    },

    async userNames(userId) {
      const user = users.get(userId);
      return user ? [user.name, user.email?.split('@')[0]].filter(Boolean) : [];
    },
  };
}
