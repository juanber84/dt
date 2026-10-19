import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createLogger } from '@digitaltwin/logger';
import { NutritionError, NutritionErrorCode } from '@digitaltwin/nutrition';
import { loadConfig } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { buildApp } from './helpers.js';

const TOKEN = 'token-de-pruebas-largo';

const entry = {
  id: '6f1c2a3e-1b2c-4d5e-8f90-123456789abc',
  source: 'telegram',
  text: 'avena 40g a las 8',
  dishes: [
    {
      name: 'Avena',
      eatenAt: '2026-10-13T06:00:00.000Z',
      items: [
        {
          name: 'Avena',
          quantity: 40,
          unit: 'g',
          kcal: 150,
          proteinG: 5.3,
          carbsG: 23.6,
          fatG: 2.8,
          fiberG: 4,
        },
      ],
    },
  ],
  createdAt: '2026-10-13T12:32:00.000Z',
};

const app = () => buildApp({ DIGITALTWIN_API_KEYS: `bot:${TOKEN}` });

describe('POST /api/v1/nutrition/entries', () => {
  it('acepta una entrada válida y devuelve el total', async () => {
    const res = await request(app())
      .post('/api/v1/nutrition/entries')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(entry)
      .expect(201);
    expect(res.body).toEqual({
      id: entry.id,
      dishes: 1,
      total: { kcal: 150, proteinG: 5.3, carbsG: 23.6, fatG: 2.8, fiberG: 4 },
    });
  });

  it('exige el token', async () => {
    await request(app()).post('/api/v1/nutrition/entries').send(entry).expect(401);
    await request(app())
      .post('/api/v1/nutrition/entries')
      .set('Authorization', 'Bearer otro-token-cualquiera')
      .send(entry)
      .expect(401);
  });

  it('valida el cuerpo', async () => {
    const res = await request(app())
      .post('/api/v1/nutrition/entries')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ ...entry, dishes: [] })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('sin API key ni sesión pide autenticación', async () => {
    await request(buildApp()).post('/api/v1/nutrition/entries').send(entry).expect(401);
  });
});

const analysis = {
  dishes: entry.dishes,
  notes: '',
  messages: [
    { role: 'user', content: 'avena 40g a las 8' },
    { role: 'assistant', content: '{"items":[]}' },
  ],
};

function appWith(nutritionAnalyzer) {
  return createApp({
    config: loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DIGITALTWIN_API_KEYS: `bot:${TOKEN}`,
    }),
    logger: createLogger({ level: 'silent', pretty: false }),
    nutritionAnalyzer,
  });
}

const post = (app, path) =>
  request(app).post(`/api/v1/nutrition/${path}`).set('Authorization', `Bearer ${TOKEN}`);

describe('POST /api/v1/nutrition/analyze', () => {
  it('estima con el LLM a partir de texto y foto', async () => {
    const analyzer = { analyze: vi.fn().mockResolvedValue(analysis), refine: vi.fn() };
    const res = await post(appWith(analyzer), 'analyze')
      .send({
        text: 'avena 40g a las 8',
        image: { base64: 'AQID', mimeType: 'image/jpeg' },
        now: '2026-10-13T12:32:00.000Z',
      })
      .expect(200);

    expect(res.body).toEqual(analysis);
    const input = analyzer.analyze.mock.calls[0][0];
    expect(input.text).toBe('avena 40g a las 8');
    expect([...input.image.data]).toEqual([1, 2, 3]);
    expect(input.now.toISOString()).toBe('2026-10-13T12:32:00.000Z');
  });

  it('exige texto o imagen y el token', async () => {
    const analyzer = { analyze: vi.fn(), refine: vi.fn() };
    await post(appWith(analyzer), 'analyze').send({ text: '  ' }).expect(400);
    await request(appWith(analyzer))
      .post('/api/v1/nutrition/analyze')
      .send({ text: 'x' })
      .expect(401);
    expect(analyzer.analyze).not.toHaveBeenCalled();
  });

  it('acepta fotos de más de 1 MB', async () => {
    const analyzer = { analyze: vi.fn().mockResolvedValue(analysis), refine: vi.fn() };
    const base64 = Buffer.alloc(2 * 1024 * 1024).toString('base64');
    await post(appWith(analyzer), 'analyze')
      .send({ image: { base64, mimeType: 'image/jpeg' } })
      .expect(200);
  });

  it('traduce los errores del LLM a 502', async () => {
    const analyzer = {
      analyze: vi
        .fn()
        .mockRejectedValue(
          new NutritionError(NutritionErrorCode.API_ERROR, '402: Insufficient Balance'),
        ),
    };
    const res = await post(appWith(analyzer), 'analyze').send({ text: 'x' }).expect(502);
    expect(res.body.error).toMatchObject({
      code: 'LLM_API_ERROR',
      message: 'LLM: 402: Insufficient Balance',
    });
  });

  it('503 si no hay LLM configurado', async () => {
    const res = await post(appWith(undefined), 'analyze').send({ text: 'x' }).expect(503);
    expect(res.body.error.code).toBe('LLM_NOT_CONFIGURED');
  });
});

describe('POST /api/v1/nutrition/refine', () => {
  it('rehace el análisis con la conversación y la corrección', async () => {
    const analyzer = { analyze: vi.fn(), refine: vi.fn().mockResolvedValue(analysis) };
    await post(appWith(analyzer), 'refine')
      .send({ messages: analysis.messages, correction: 'eran 60 g' })
      .expect(200);
    expect(analyzer.refine).toHaveBeenCalledWith({ messages: analysis.messages }, 'eran 60 g');
  });

  it('valida la conversación', async () => {
    const analyzer = { analyze: vi.fn(), refine: vi.fn() };
    await post(appWith(analyzer), 'refine')
      .send({ messages: [{ role: 'system', content: 'x' }], correction: 'y' })
      .expect(400);
  });
});
