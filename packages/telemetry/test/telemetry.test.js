import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { context, propagation, trace, SpanStatusCode } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { TRACE_FIELD, withJobSpan, withSpan, withTraceContext } from '../src/index.js';

describe('sin SDK', () => {
  it('no toca los datos ni falla', async () => {
    const data = { userId: 'u1' };
    expect(withTraceContext(data)).toBe(data);
    expect(await withSpan('x', {}, async () => 42)).toBe(42);
    expect(await withJobSpan('sync', { id: '1', data }, async () => 'ok')).toBe('ok');
  });
});

describe('con SDK', () => {
  const exporter = new InMemorySpanExporter();
  const contextManager = new AsyncLocalStorageContextManager();

  beforeAll(() => {
    context.setGlobalContextManager(contextManager.enable());
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    trace.setGlobalTracerProvider(
      new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
    );
  });
  afterAll(() => {
    trace.disable();
    propagation.disable();
    context.disable();
  });
  beforeEach(() => exporter.reset());

  it('el trabajo encolado dentro de una traza sigue en ella en el worker', async () => {
    let job;
    await withSpan('POST /api/v1/nutrition', {}, async () => {
      job = { id: 'j1', data: withTraceContext({ userId: 'u1', provider: 'google' }) };
    });
    expect(job.data.userId).toBe('u1');
    expect(job.data[TRACE_FIELD].traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);

    await withJobSpan('sync', job, async () => {});
    const [request, consumer] = exporter.getFinishedSpans();
    expect(consumer.name).toBe('job sync');
    expect(consumer.spanContext().traceId).toBe(request.spanContext().traceId);
    expect(consumer.parentSpanContext?.spanId).toBe(request.spanContext().spanId);
    expect(consumer.attributes).toMatchObject({
      'messaging.destination.name': 'sync',
      'messaging.message.id': 'j1',
      'digitaltwin.provider': 'google',
    });
  });

  it('marca el span como error y deja pasar la excepción', async () => {
    await expect(
      withJobSpan('fetch', { id: 'j2', data: {} }, async () => {
        throw new Error('Google 500');
      }),
    ).rejects.toThrow('Google 500');
    const [span] = exporter.getFinishedSpans();
    expect(span.status).toEqual({ code: SpanStatusCode.ERROR, message: 'Google 500' });
    expect(span.events[0].name).toBe('exception');
  });

  it('fuera de una traza no añade nada a los datos', () => {
    const data = { a: 1 };
    expect(withTraceContext(data)).toBe(data);
  });
});
