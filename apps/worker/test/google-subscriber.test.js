import { describe, it, expect, vi } from 'vitest';
import { JOBS } from '@digitaltwin/queue';
import { createJobs } from '../src/jobs.js';

const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn() };
const config = {
  PUBLIC_URL: 'https://dt.example.com',
  GOOGLE_HEALTH_WEBHOOK_SECRET: 'clave-de-pruebas-larga',
};

function setup(googleSubscribers) {
  return createJobs({
    queue: {},
    pipeline: { store: {} },
    connections: {},
    providers: {},
    googleSubscribers,
    config,
    logger,
  }).handlers[JOBS.GOOGLE_SUBSCRIBER];
}

describe('google-subscriber', () => {
  it('deja el suscriptor apuntando al webhook de PUBLIC_URL', async () => {
    const ensure = vi.fn().mockResolvedValue({ action: 'created' });
    expect(await setup({ ensure })({ data: { force: true } })).toEqual({ action: 'created' });
    expect(ensure).toHaveBeenCalledWith({
      subscriberId: 'digitaltwin',
      endpointUri: 'https://dt.example.com/webhooks/google-health',
      secret: 'clave-de-pruebas-larga',
      force: true,
    });
  });

  it('sin cuenta de servicio no hace nada', async () => {
    expect(await setup(undefined)({ data: {} })).toEqual({ skipped: 'unconfigured' });
  });
});
