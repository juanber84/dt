import { describe, it, expect, vi } from 'vitest';
import { JOBS } from '@digitaltwin/queue';
import { EmailError, EmailErrorCode } from '@digitaltwin/email';
import { createJobs } from '../src/jobs.js';

const handlerWith = (email) =>
  createJobs({
    queue: { send: vi.fn() },
    pipeline: { store: {} },
    connections: {},
    providers: {},
    email,
    config: {},
    logger: { info() {}, debug() {}, warn() {} },
  }).handlers[JOBS.EMAIL];

const data = {
  userId: 'ana',
  email: { kind: 'daily-report', to: 'ana@example.com', subject: 'Ayer', html: '', text: '' },
};

describe('job email', () => {
  it('manda el correo del usuario', async () => {
    const send = vi.fn(async () => ({ status: 'sent', id: 'em_1' }));
    expect(await handlerWith({ send })({ data })).toEqual({ status: 'sent', id: 'em_1' });
    expect(send).toHaveBeenCalledWith('ana', data.email);
  });

  it('si Resend lo rechaza no se reintenta; si limita o falla, sí (lanza para la cola)', async () => {
    const rejected = handlerWith({
      send: async () => {
        throw new EmailError(EmailErrorCode.REJECTED, 'Resend 403: domain not verified');
      },
    });
    expect(await rejected({ data })).toEqual({
      status: 'rejected',
      error: 'Resend 403: domain not verified',
    });

    const limited = handlerWith({
      send: async () => {
        throw new EmailError(EmailErrorCode.RETRYABLE, 'Resend 429');
      },
    });
    await expect(limited({ data })).rejects.toThrow('Resend 429');
  });

  it('sin Resend configurado no hace nada', async () => {
    expect(await handlerWith(undefined)({ data })).toEqual({ skipped: 'unconfigured' });
  });
});
