import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { z } from 'zod';
import { buildApp } from './helpers.js';
import { validate } from '../src/middlewares/validate.js';
import { errorHandler } from '../src/middlewares/error-handler.js';
import { HttpError } from '../src/utils/http-error.js';

describe('API', () => {
  it('GET /health responde ok', async () => {
    const res = await request(buildApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /api/v1/health/ready devuelve info del servicio', async () => {
    const res = await request(buildApp()).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(typeof res.body.uptime).toBe('number');
  });

  it('readiness comprueba la BD si hay', async () => {
    const db = async () => [{ '?column?': 1 }];
    const res = await request(buildApp({}, { db })).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.checks).toEqual({ db: 'ok' });
  });

  it('readiness responde 503 si la BD no responde, pero /health sigue ok', async () => {
    const db = async () => {
      throw new Error('ECONNREFUSED');
    };
    const app = buildApp({}, { db });
    const ready = await request(app).get('/api/v1/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body).toMatchObject({ status: 'degraded', checks: { db: 'down' } });
    expect((await request(app).get('/health')).status).toBe(200);
  });

  it('devuelve 404 con formato de error uniforme', async () => {
    const res = await request(buildApp()).get('/no-existe');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.body.error.requestId).toBeDefined();
  });

  it('propaga X-Request-Id', async () => {
    const res = await request(buildApp()).get('/health').set('X-Request-Id', 'abc-123');
    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('aplica cabeceras de seguridad (helmet) y oculta x-powered-by', async () => {
    const res = await request(buildApp()).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('responde 400 ante JSON malformado', async () => {
    const res = await request(buildApp())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"mal":');
    expect(res.status).toBe(400);
  });
});

describe('CORS', () => {
  const env = { CORS_ORIGINS: 'http://localhost:5173' };

  it('permite orígenes configurados', async () => {
    const res = await request(buildApp(env)).get('/health').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('responde al preflight', async () => {
    const res = await request(buildApp(env))
      .options('/api/v1/health')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(204);
  });

  it('rechaza orígenes no permitidos', async () => {
    const res = await request(buildApp(env)).get('/health').set('Origin', 'http://malo.com');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CORS_FORBIDDEN');
  });
});

describe('validate middleware', () => {
  const app = express();
  app.use(express.json());
  app.post('/', validate({ body: z.object({ name: z.string().min(1) }) }), (req, res) =>
    res.json(req.validated.body),
  );
  app.use(errorHandler({ isProduction: false }));

  it('acepta datos válidos', async () => {
    const res = await request(app).post('/').send({ name: 'twin' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'twin' });
  });

  it('rechaza datos inválidos con detalles', async () => {
    const res = await request(app).post('/').send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0]).toMatchObject({ location: 'body', path: 'name' });
  });
});

describe('errorHandler en producción', () => {
  const app = express();
  app.get('/http', () => {
    throw new HttpError(502, 'LLM: 402: Insufficient Balance', { code: 'LLM_API_ERROR' });
  });
  app.get('/boom', () => {
    throw new Error('detalle interno');
  });
  app.use(errorHandler({ isProduction: true }));

  it('muestra el mensaje de los HttpError y oculta los errores inesperados', async () => {
    const http = await request(app).get('/http');
    expect(http.body.error).toMatchObject({
      code: 'LLM_API_ERROR',
      message: 'LLM: 402: Insufficient Balance',
    });
    expect(http.body.error.stack).toBeUndefined();

    const boom = await request(app).get('/boom');
    expect(boom.body.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Internal Server Error',
    });
  });
});
