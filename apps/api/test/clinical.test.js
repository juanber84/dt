import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import {
  buildExtraction,
  createMemoryClinicalStore,
  modelOutputSchema,
} from '@digitaltwin/clinical';
import { createMemoryQueue, JOBS } from '@digitaltwin/queue';
import { buildApp } from './helpers.js';
import { loginCookie, testUsers } from './auth-helpers.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n');
const TEXT = `Fecha: 07/10/2026
Creatinina      1.41     mg/dl     (0.6 - 1.3)  *
Antígeno raro   12.0     U/mL      (Inf. 35)`;
const OUTPUT = modelOutputSchema.parse({
  type: 'lab',
  title: 'Analítica',
  center: 'Laboratorio X',
  date: '2026-10-07',
  items: [
    {
      section: 'Bioquímica',
      name: 'Creatinina',
      value_text: '1.41',
      value: 1.41,
      unit: 'mg/dl',
      range_text: '(0.6 - 1.3)',
      range_min: 0.6,
      range_max: 1.3,
      flag: 'high',
    },
    {
      section: 'Bioquímica',
      name: 'Antígeno raro',
      value_text: '12.0',
      value: 12,
      unit: 'U/mL',
      range_text: '(Inf. 35)',
      range_max: 35,
    },
  ],
});

describe('/api/v1/clinical', () => {
  let app;
  let store;
  let queue;
  let pipeline;
  let admin;
  let ana;

  const upload = (cookie, body = PDF, name = 'analítica.pdf') =>
    request(app)
      .post(`/api/v1/clinical/documents?name=${encodeURIComponent(name)}`)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/pdf')
      .send(body);

  /** Lo que haría el worker: dejar el documento leído y para revisar. */
  async function uploadAndRead() {
    const res = await upload(admin);
    const id = res.body.document.id;
    await store.saveExtraction(id, {
      text: TEXT,
      redactions: 3,
      extraction: buildExtraction(OUTPUT, TEXT),
    });
    return id;
  }

  beforeEach(async () => {
    store = createMemoryClinicalStore();
    queue = createMemoryQueue();
    pipeline = {
      queries: {},
      ingest: vi.fn().mockResolvedValue({ id: 7, changed: true, inserted: true }),
      store: { markRawDeleted: vi.fn().mockResolvedValue(7) },
    };
    app = buildApp({}, { users: await testUsers(), queue, pipeline, clinicalStore: store });
    admin = await loginCookie(app);
    ana = await loginCookie(app, 'ana@example.com');
  });

  it('sin sesión no se entra', async () => {
    await request(app).get('/api/v1/clinical/documents').expect(401);
  });

  it('sube un PDF, encola su lectura y no duplica si se sube otra vez', async () => {
    const first = await upload(admin).expect(201);
    expect(first.body).toMatchObject({
      created: true,
      document: { status: 'processing', fileName: 'analítica.pdf', sizeBytes: PDF.length },
    });
    expect(queue.jobs).toEqual([
      expect.objectContaining({
        name: JOBS.CLINICAL_EXTRACT,
        data: { documentId: first.body.document.id },
      }),
    ]);

    const again = await upload(admin).expect(200);
    expect(again.body).toMatchObject({ created: false, document: { id: first.body.document.id } });
    expect(queue.jobs).toHaveLength(1);

    const list = await request(app).get('/api/v1/clinical/documents').set('Cookie', admin);
    expect(list.body.items).toHaveLength(1);
  });

  it('solo acepta PDFs', async () => {
    const res = await upload(admin, Buffer.from('hola')).expect(415);
    expect(res.body.error.code).toBe('NOT_A_PDF');
    expect(queue.jobs).toHaveLength(0);
  });

  it('el detalle trae lo extraído (y el PDF ya no se descarga)', async () => {
    const id = await uploadAndRead();
    const res = await request(app).get(`/api/v1/clinical/documents/${id}`).set('Cookie', admin);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'review',
      type: 'lab',
      date: '2026-10-07',
      counts: { items: 2, flagged: 1, issues: 1 },
      text: TEXT,
    });
    expect(res.body.extraction.items[0]).toMatchObject({
      name: 'Creatinina',
      metric: 'lab.creatinine',
    });

    await request(app)
      .get(`/api/v1/clinical/documents/${id}/file`)
      .set('Cookie', admin)
      .expect(404);
  });

  it('recuerda el día desde el que se sube (y rechaza uno mal escrito)', async () => {
    const res = await request(app)
      .post('/api/v1/clinical/documents?name=a.pdf&date=2026-10-18')
      .set('Cookie', admin)
      .set('Content-Type', 'application/pdf')
      .send(PDF)
      .expect(201);
    expect(res.body.document).toMatchObject({ requestedDate: '2026-10-18', date: null });
    await request(app)
      .post('/api/v1/clinical/documents?name=a.pdf&date=18/10/2026')
      .set('Cookie', admin)
      .set('Content-Type', 'application/pdf')
      .send(PDF)
      .expect(400);
  });

  it('nadie ve ni toca los documentos de otro', async () => {
    const id = await uploadAndRead();
    await request(app).get(`/api/v1/clinical/documents/${id}`).set('Cookie', ana).expect(404);
    await request(app).delete(`/api/v1/clinical/documents/${id}`).set('Cookie', ana).expect(404);
    const list = await request(app).get('/api/v1/clinical/documents').set('Cookie', ana);
    expect(list.body.items).toEqual([]);
  });

  it('lo corregido se recalcula: la métrica elegida, su conversión y los avisos', async () => {
    const id = await uploadAndRead();
    const { body: doc } = await request(app)
      .get(`/api/v1/clinical/documents/${id}`)
      .set('Cookie', admin);
    const extraction = structuredClone(doc.extraction);
    extraction.items[1].metric = 'lab.crp';
    extraction.items[1].unit = 'mg/L';
    const res = await request(app)
      .put(`/api/v1/clinical/documents/${id}`)
      .set('Cookie', admin)
      .send({ extraction });
    expect(res.status).toBe(200);
    expect(res.body.extraction.items[1]).toMatchObject({
      metric: 'lab.crp',
      metricValue: 12,
      metricUnit: 'mg/L',
      issues: [],
    });

    const bad = await request(app)
      .put(`/api/v1/clinical/documents/${id}`)
      .set('Cookie', admin)
      .send({ extraction: { ...extraction, type: 'raro' } });
    expect(bad.status).toBe(400);
  });

  it('al confirmar va al timeline y recuerda los nombres asignados a mano', async () => {
    const id = await uploadAndRead();
    const { body: doc } = await request(app)
      .get(`/api/v1/clinical/documents/${id}`)
      .set('Cookie', admin);
    const extraction = structuredClone(doc.extraction);
    extraction.items[1].metric = 'lab.crp';
    extraction.items[1].unit = 'mg/L';

    const res = await request(app)
      .post(`/api/v1/clinical/documents/${id}/confirm`)
      .set('Cookie', admin)
      .send({ extraction });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmed');
    expect(pipeline.ingest).toHaveBeenCalledWith({
      userId: 'admin',
      provider: 'clinical',
      kind: 'document',
      externalId: id,
      periodStart: new Date('2026-10-07T06:00:00.000Z'),
      periodEnd: new Date('2026-10-07T06:00:00.001Z'),
      payload: { documentId: id, fileName: 'analítica.pdf', extraction: res.body.extraction },
    });
    expect(await store.aliases('admin')).toEqual(new Map([['antigeno raro', 'lab.crp']]));

    const params = await request(app).get('/api/v1/clinical/parameters').set('Cookie', admin);
    expect(params.body.items.map((p) => [p.code, p.latest.value])).toEqual([
      ['lab.creatinine', 1.41],
      ['lab.crp', 12],
    ]);
  });

  it('sin fecha no se puede confirmar', async () => {
    const id = await uploadAndRead();
    const { body: doc } = await request(app)
      .get(`/api/v1/clinical/documents/${id}`)
      .set('Cookie', admin);
    const res = await request(app)
      .post(`/api/v1/clinical/documents/${id}/confirm`)
      .set('Cookie', admin)
      .send({ extraction: { ...doc.extraction, date: null } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DATE_REQUIRED');
    expect(pipeline.ingest).not.toHaveBeenCalled();
  });

  it('borrar quita también lo que generó en el timeline', async () => {
    const id = await uploadAndRead();
    queue.jobs.length = 0;
    await request(app).delete(`/api/v1/clinical/documents/${id}`).set('Cookie', admin).expect(204);
    expect(pipeline.store.markRawDeleted).toHaveBeenCalledWith({
      userId: 'admin',
      provider: 'clinical',
      kind: 'document',
      externalId: id,
    });
    expect(queue.jobs).toEqual([
      expect.objectContaining({ name: JOBS.NORMALIZE, data: { rawId: 7 } }),
    ]);
    await request(app).get(`/api/v1/clinical/documents/${id}`).set('Cookie', admin).expect(404);
  });

  it('reintentar uno con error lo vuelve a encolar', async () => {
    const { body } = await upload(admin);
    const id = body.document.id;
    await store.fail(id, 'El modelo ha tardado demasiado');
    queue.jobs.length = 0;
    const res = await request(app)
      .post(`/api/v1/clinical/documents/${id}/retry`)
      .set('Cookie', admin);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'processing', error: null });
    expect(queue.jobs).toHaveLength(1);
  });

  it('las métricas para elegir al revisar', async () => {
    const res = await request(app).get('/api/v1/clinical/metrics').set('Cookie', admin);
    expect(res.body.items).toEqual(
      expect.arrayContaining([
        { code: 'lab.creatinine', label: 'Creatinina', unit: 'mg/dL', section: 'Bioquímica' },
        expect.objectContaining({ code: 'fitness.vo2max', section: 'Prueba de esfuerzo' }),
      ]),
    );
  });
});
