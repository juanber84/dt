import { describe, it, expect, vi } from 'vitest';
import { JOBS } from '@digitaltwin/queue';
import { SCOPES } from '@digitaltwin/google-health';
import { createJobs, googleSubscriptionId } from '../src/jobs.js';

const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn() };
const config = {
  PUBLIC_URL: 'https://dt.example.com',
  GOOGLE_HEALTH_WEBHOOK_SECRET: 'clave-de-pruebas-larga',
};

const ANA = '1b972800-da50-476b-ae73-6930e40a67c3';

function setup(googleSubscribers, connected = []) {
  return createJobs({
    queue: {},
    pipeline: { store: {} },
    connections: { listByProvider: vi.fn(async () => connected) },
    providers: {},
    googleSubscribers,
    config,
    logger,
  }).handlers[JOBS.GOOGLE_SUBSCRIBER];
}

describe('google-subscriber', () => {
  const none = { created: 0, updated: 0, deleted: 0, unchanged: 0 };

  it('deja el suscriptor (MANUAL) apuntando al webhook de PUBLIC_URL', async () => {
    const ensure = vi.fn().mockResolvedValue({ action: 'created' });
    const ensureSubscriptions = vi.fn().mockResolvedValue(none);
    expect(await setup({ ensure, ensureSubscriptions })({ data: { force: true } })).toEqual({
      action: 'created',
      subscriptions: none,
    });
    expect(ensure).toHaveBeenCalledWith({
      subscriberId: 'digitaltwin',
      endpointUri: 'https://dt.example.com/webhooks/google-health',
      secret: 'clave-de-pruebas-larga',
      policy: 'MANUAL',
      force: true,
    });
  });

  it('una suscripción por usuario conectado, con los tipos que concedió', async () => {
    const ensure = vi.fn().mockResolvedValue({ action: 'unchanged' });
    const ensureSubscriptions = vi.fn().mockResolvedValue({ ...none, created: 1 });
    await setup({ ensure, ensureSubscriptions }, [
      { userId: ANA, externalUserId: '3927607755923926745', credentials: { scope: SCOPES.SLEEP } },
      // Sin id de Google (conexión antigua) o sin ningún tipo que avise: no se suscribe
      { userId: 'otro', credentials: { scope: SCOPES.SLEEP } },
      { userId: 'ecg', externalUserId: '1', credentials: { scope: SCOPES.ECG } },
    ])({ data: {} });

    expect(ensureSubscriptions).toHaveBeenCalledWith('digitaltwin', [
      {
        subscriptionId: 'u1b972800da50476bae736930e40a67c3',
        healthUserId: '3927607755923926745',
        dataTypes: ['sleep'],
      },
    ]);
  });

  it('el id de la suscripción vale para Google (4-36, empieza por letra)', () => {
    const id = googleSubscriptionId(ANA);
    expect(id).toMatch(/^[a-z][a-z0-9-]{2,34}[a-z0-9]$/);
  });

  it('sin cuenta de servicio no hace nada', async () => {
    expect(await setup(undefined)({ data: {} })).toEqual({ skipped: 'unconfigured' });
  });
});
