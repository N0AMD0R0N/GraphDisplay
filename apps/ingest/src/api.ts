import type { FastifyInstance } from 'fastify';
import { CONTENT_TYPE_JSON } from '@gd/api-contract';
import { ERROR_CODES, HEALTH } from './constants';
import { rebuildSchema, runPipeline } from './pipeline';
import type { IngestAppDeps } from './types';

/**
 * The endpoints of the ingestion service (ingest.openapi.yaml): upload, schema rebuild, the reserved async jobs
 * and health.
 */
export function registerApi(app: FastifyInstance, { dal, config, maxUploadBytes }: IngestAppDeps): void {
  const deps = { dal, config };

  // The body is kept as text so that malformed JSON is judged by the pipeline (-> 401), not by Fastify.
  app.addContentTypeParser(CONTENT_TYPE_JSON, { parseAs: 'string' }, (_req, body, done) => done(null, body));

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) app.log.error(err);
    const message =
      err.code === ERROR_CODES.bodyTooLarge
        ? `Upload exceeds the limit of ${maxUploadBytes} bytes`
        : status >= 500
          ? 'The ingestion service failed to process the graph'
          : err.message;
    return reply.code(status).send({ error: { status, code: err.code ?? ERROR_CODES.ingestFailed, message } });
  });

  app.post<{ Querystring: { name?: string }; Body: string | undefined }>('/ingest/graphs', async (req, reply) => {
    const outcome = await runPipeline(req.body, { name: req.query.name }, deps);
    return reply.code(outcome.status).send(outcome.body);
  });

  app.post<{ Params: { id: string } }>('/ingest/graphs/:id/rebuild', async (req, reply) => {
    const result = await rebuildSchema(req.params.id, deps);
    if (!result) {
      return reply
        .code(404)
        .send({ error: { status: 404, code: ERROR_CODES.graphNotFound, message: 'Graph not found' } });
    }
    return result;
  });

  // Reserved: async ingestion for very large or segmented graphs (A14.2).
  const notImplemented = async (_req: unknown, reply: { code(n: number): { send(b: unknown): unknown } }) =>
    reply
      .code(501)
      .send({ error: { status: 501, code: ERROR_CODES.notImplemented, message: 'Async ingestion is reserved' } });
  app.post('/ingest/jobs', notImplemented);
  app.get('/ingest/jobs/:id', notImplemented);

  app.get('/ingest/health', async () => {
    const health = await dal.health().catch(() => null);
    return { status: health ? HEALTH.ok : HEALTH.degraded, dal: health?.status === HEALTH.ok };
  });
}
