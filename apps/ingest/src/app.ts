import Fastify, { type FastifyInstance } from 'fastify';
import type { DalClient } from '@gd/dal-contract';
import type { IngestConfig } from '@gd/graph-core';
import { rebuildSchema, runPipeline } from './pipeline';

export interface IngestAppDeps {
  dal: DalClient;
  config: IngestConfig;
  maxUploadBytes: number;
  logger?: boolean;
}

export function createIngestApp({ dal, config, maxUploadBytes, logger = false }: IngestAppDeps): FastifyInstance {
  const app = Fastify({ logger, bodyLimit: maxUploadBytes });
  const deps = { dal, config };

  // The body is kept as text so that malformed JSON is judged by the pipeline (-> 401), not by Fastify.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) app.log.error(err);
    const message =
      err.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
        ? `Upload exceeds the limit of ${maxUploadBytes} bytes`
        : status >= 500
          ? 'The ingestion service failed to process the graph'
          : err.message;
    return reply.code(status).send({ error: { status, code: err.code ?? 'INGEST_ERROR', message } });
  });

  app.post<{ Querystring: { name?: string }; Body: string | undefined }>('/ingest/graphs', async (req, reply) => {
    const outcome = await runPipeline(req.body, { name: req.query.name }, deps);
    return reply.code(outcome.status).send(outcome.body);
  });

  app.post<{ Params: { id: string } }>('/ingest/graphs/:id/rebuild', async (req, reply) => {
    const result = await rebuildSchema(req.params.id, deps);
    if (!result) {
      return reply.code(404).send({ error: { status: 404, code: 'GRAPH_NOT_FOUND', message: 'Graph not found' } });
    }
    return result;
  });

  // Reserved: async ingestion for very large or segmented graphs (A14.2).
  const notImplemented = async (_req: unknown, reply: { code(n: number): { send(b: unknown): unknown } }) =>
    reply.code(501).send({ error: { status: 501, code: 'NOT_IMPLEMENTED', message: 'Async ingestion is reserved' } });
  app.post('/ingest/jobs', notImplemented);
  app.get('/ingest/jobs/:id', notImplemented);

  app.get('/ingest/health', async () => {
    const health = await dal.health().catch(() => null);
    return { status: health ? 'ok' : 'degraded', dal: health?.status === 'ok' };
  });

  return app;
}
