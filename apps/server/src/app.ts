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

/** The most node or edge ids one request may ask for (the URL carries them). */
export const MAX_ENTITY_IDS = 1000;

/** Reads the repeated `id` query parameter: `?id=a&id=b`. */
function entityIds(value: string | string[] | undefined): string[] {
  const ids = [...new Set(value === undefined ? [] : Array.isArray(value) ? value : [value])].filter(Boolean);
  if (ids.length === 0) throw new QueryError('Give at least one id, as repeated "id" parameters', 'MISSING_IDS', 400);
  if (ids.length > MAX_ENTITY_IDS) {
    throw new QueryError(`At most ${MAX_ENTITY_IDS} ids per request; split the request`, 'TOO_MANY_IDS', 400);
  }
  return ids;
}

function parseBoolean(name: string, value: string): boolean {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new QueryError(`"${name}" must be true or false`, 'INVALID_QUERY');
}

const notFound = (message: string) => ({ error: { status: 404, code: 'NOT_FOUND', message } });

/** Public REST API (WorkPlan §3.6). It has no database connections: storage goes through the DAL. */
export function createServer(deps: ServerDeps): FastifyInstance {
  const { dal, ingest, limits } = deps;
  // queries are sent in the URL: allow long query strings (a 200-condition query is about 25 KB)
  const app = Fastify({
    logger: deps.logger ?? false,
    bodyLimit: 16 * 1024 * 1024,
    http: { maxHeaderSize: 64 * 1024 },
  });
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

  // Nodes and edges are fetched separately from the routes: a route lists ids only. Unknown ids are left out,
  // the others come back in the order requested.
  app.get<{ Params: { id: string }; Querystring: { id?: string | string[] } }>(
    '/graphs/:id/nodes',
    async (req, reply) => {
      const wanted = entityIds(req.query.id);
      if (!(await dal.getGraph(req.params.id))) return reply.code(404).send(notFound('Graph not found'));
      const { nodes } = await dal.entities(req.params.id, { nodeIds: wanted, edgeIds: [] });
      const byId = new Map(nodes.map((n) => [n.id, n]));
      return wanted.flatMap((id) => byId.get(id) ?? []);
    },
  );

  app.get<{ Params: { id: string }; Querystring: { id?: string | string[] } }>(
    '/graphs/:id/edges',
    async (req, reply) => {
      const wanted = entityIds(req.query.id);
      if (!(await dal.getGraph(req.params.id))) return reply.code(404).send(notFound('Graph not found'));
      const { edges } = await dal.entities(req.params.id, { nodeIds: [], edgeIds: wanted });
      const byId = new Map(edges.map((e) => [e.id, e]));
      return wanted.flatMap((id) => byId.get(id) ?? []);
    },
  );

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

  // The query travels in the URL (GET), so a query can be bookmarked, shared and seen in the browser's address bar.
  app.get<{
    Params: { id: string };
    Querystring: { q?: string; limit?: string; maxHops?: string; routeMode?: string; includeSubRoutes?: string };
  }>('/graphs/:id/routes/query', async (req) => {
    const { q, limit, maxHops, routeMode, includeSubRoutes } = req.query;
    if (q === undefined || q === '') {
      throw new QueryError('Missing "q": the query as JSON (a set tree)', 'MISSING_QUERY', 400);
    }
    let query: unknown;
    try {
      query = JSON.parse(q);
    } catch {
      throw new QueryError('"q" is not valid JSON', 'INVALID_QUERY_PARAM', 400);
    }
    return runQuery(queryDeps, req.params.id, {
      query,
      ...(limit !== undefined && { limit: Number(limit) }),
      ...(maxHops !== undefined && { maxHops: Number(maxHops) }),
      ...(routeMode !== undefined && { routeMode }),
      ...(includeSubRoutes !== undefined && { includeSubRoutes: parseBoolean('includeSubRoutes', includeSubRoutes) }),
    });
  });

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
