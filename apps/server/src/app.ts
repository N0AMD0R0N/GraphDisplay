import Fastify, { type FastifyInstance } from 'fastify';
import { ServiceCallError, type ExpandRequest } from '@gd/api-contract';
import type { DalClient } from '@gd/dal-contract';
import type { IngestClient } from '@gd/ingest-contract';
import { cypherLanguage } from '@gd/lang-cypher';
import { QueryError, type QueryLanguage } from '@gd/query-core';
import { getSchema, runQuery, type ServerLimits } from './query';
import { expandView, getView } from './view';

export interface ServerDeps {
  dal: DalClient;
  ingest: IngestClient;
  limits: ServerLimits;
  maxUploadBytes: number;
  logger?: boolean;
  languages?: QueryLanguage[];
}

const notFound = (message: string) => ({ error: { status: 404, code: 'NOT_FOUND', message } });

/** Public REST API (WorkPlan §3.6). It has no database connections: storage goes through the DAL. */
export function createServer(deps: ServerDeps): FastifyInstance {
  const { dal, ingest, limits } = deps;
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 16 * 1024 * 1024 });
  const languages = new Map((deps.languages ?? [cypherLanguage]).map((l) => [l.id, l]));
  const queryDeps = { dal, ingest, languages, limits };

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
    if (err instanceof QueryError) {
      return reply.code(err.status).send({ error: { status: err.status, code: err.code, message: err.message } });
    }
    if (err instanceof ServiceCallError) {
      const upstream = (err.body as { error?: { code?: string; message?: string } } | undefined)?.error;
      const status = err.status === 404 ? 404 : 502;
      return reply.code(status).send({
        error: { status, code: upstream?.code ?? 'UPSTREAM_ERROR', message: upstream?.message ?? err.message },
      });
    }
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({
      error: {
        status,
        code: err.code ?? 'SERVER_ERROR',
        message: status >= 500 ? 'Internal server error' : err.message,
      },
    });
  });

  // Uploads are forwarded as raw text so the ingestion service decides about malformed JSON (-> 401).
  app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'string', bodyLimit: deps.maxUploadBytes },
      (_r, body, done) => done(null, body),
    );
    scope.post<{ Querystring: { name?: string }; Body: string | undefined }>('/graphs', async (req, reply) => {
      const outcome = await ingest.ingest(req.body ?? '', req.query.name);
      return reply.code(outcome.status).send(outcome.body);
    });
  });

  app.get('/graphs', async () => dal.listGraphs());

  app.get<{ Params: { id: string } }>('/graphs/:id', async (req, reply) => {
    const graph = await dal.getGraph(req.params.id);
    return graph ?? reply.code(404).send(notFound('Graph not found'));
  });

  app.delete<{ Params: { id: string } }>('/graphs/:id', async (req, reply) => {
    if (!(await dal.getGraph(req.params.id))) return reply.code(404).send(notFound('Graph not found'));
    await dal.deleteGraph(req.params.id);
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>('/graphs/:id/schema', async (req, reply) => {
    const schema = await getSchema(queryDeps, req.params.id);
    return schema ?? reply.code(404).send(notFound('Graph not found'));
  });

  app.get<{ Params: { id: string }; Querystring: { pin?: string; limit?: string } }>(
    '/graphs/:id/view',
    async (req, reply) => {
      if (!(await dal.getGraph(req.params.id))) return reply.code(404).send(notFound('Graph not found'));
      const pins = req.query.pin ? req.query.pin.split(',').filter(Boolean) : [];
      const cap = req.query.limit ? Number(req.query.limit) : undefined;
      return getView({ dal }, req.params.id, { pins, cap: Number.isFinite(cap) ? cap : undefined });
    },
  );

  app.post<{ Params: { id: string }; Body: ExpandRequest }>('/graphs/:id/view/expand', async (req, reply) => {
    if (!(await dal.getGraph(req.params.id))) return reply.code(404).send(notFound('Graph not found'));
    const body = req.body;
    if (
      !body ||
      typeof body.nodeId !== 'string' ||
      !Array.isArray(body.visible) ||
      !['neighbors', 'component'].includes(body.mode)
    ) {
      throw new QueryError(
        'Expected { nodeId, mode: "neighbors" | "component", visible: [{id,x,y}] }',
        'INVALID_REQUEST',
        400,
      );
    }
    return expandView({ dal }, req.params.id, body);
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/graphs/:id/routes/query', async (req) =>
    runQuery(queryDeps, req.params.id, req.body),
  );

  // Reserved: connecting segmented graphs (WorkPlan A9).
  app.post('/graphs/:id/links', async (_req, reply) =>
    reply.code(501).send({ error: { status: 501, code: 'NOT_IMPLEMENTED', message: 'Linking graphs is reserved' } }),
  );

  app.get('/health', async () => {
    const [d, i] = await Promise.all([dal.health().catch(() => null), ingest.health().catch(() => null)]);
    return {
      status: d?.status === 'ok' && i?.status === 'ok' ? 'ok' : 'degraded',
      dal: d?.status ?? 'unreachable',
      ingest: i?.status ?? 'unreachable',
    };
  });

  return app;
}
