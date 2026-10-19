import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { loadConfig } from '../src/config/env.js';
import { apiKeyAuth } from '../src/middlewares/api-key-auth.js';
import { errorHandler } from '../src/middlewares/error-handler.js';
import { buildApp } from './helpers.js';

const BOT = 'clave-del-bot-0123456789';
const FRONT = 'clave-del-front-0123456789';

describe('DIGITALTWIN_API_KEYS', () => {
  it('parsea "nombre:clave" separadas por coma', () => {
    const { DIGITALTWIN_API_KEYS } = loadConfig({
      DIGITALTWIN_API_KEYS: `bot:${BOT}, front:${FRONT}`,
    });
    expect(DIGITALTWIN_API_KEYS).toEqual([
      { client: 'bot', key: BOT },
      { client: 'front', key: FRONT },
    ]);
    expect(loadConfig({}).DIGITALTWIN_API_KEYS).toEqual([]);
  });

  it('rechaza claves sin nombre o demasiado cortas', () => {
    expect(() => loadConfig({ DIGITALTWIN_API_KEYS: BOT })).toThrow(/nombre:clave/);
    expect(() => loadConfig({ DIGITALTWIN_API_KEYS: 'bot:corta' })).toThrow(/nombre:clave/);
  });
});

describe('apiKeyAuth', () => {
  const app = express();
  app.use(
    apiKeyAuth([
      { client: 'bot', key: BOT },
      { client: 'front', key: FRONT },
    ]),
  );
  app.get('/', (req, res) => res.json({ client: req.apiClient }));
  app.use(errorHandler({ isProduction: false }));

  it('identifica al cliente por su clave', async () => {
    const bot = await request(app).get('/').set('Authorization', `Bearer ${BOT}`).expect(200);
    expect(bot.body).toEqual({ client: 'bot' });
    const front = await request(app).get('/').set('Authorization', `Bearer ${FRONT}`).expect(200);
    expect(front.body).toEqual({ client: 'front' });
  });

  it('401 sin clave o con una desconocida', async () => {
    await request(app).get('/').expect(401);
    await request(app)
      .get('/')
      .set('Authorization', 'Bearer otra-clave-cualquiera-123')
      .expect(401);
    await request(app).get('/').set('Authorization', BOT).expect(401);
  });
});

describe('API con API keys', () => {
  it('/api/v1/health no pide clave; el resto sí', async () => {
    const app = buildApp({ DIGITALTWIN_API_KEYS: `bot:${BOT}` });
    await request(app).get('/api/v1/health/ready').expect(200);
    await request(app).post('/api/v1/nutrition/entries').send({}).expect(401);
  });
});
