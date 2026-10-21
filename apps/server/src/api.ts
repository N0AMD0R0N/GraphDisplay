import type { FastifyInstance, FastifyReply } from 'fastify';
import { registerOpenApiDocs } from '@gd/api-contract/src/openapi-docs';
import { CONTENT_TYPE_JSON, ServiceCallError, type ExpandRequest } from '@gd/api-contract';
import { cypherLanguage } from '@gd/lang-cypher';
import { QueryError } from '@gd/query-core';
import { ERROR_CODES, HEALTH, MAX_ENTITY_IDS, OPENAPI_DOCS, edgeId } from './constants';
import { getSchema, runQuery } from './query';
import type { ServerDeps } from './types';
import { expandView, getView } from './view';

/** Reads the repeated `id` query parameter: `?id=a&id=b`. */
function entityIds(value: string | string[] | undefined): string[] {
  const ids = [...new Set(value === undefined ? [] : Array.isArray(value) ? value : [value])].filter(Boolean);
  if (ids.length > MAX_ENTITY_IDS) {
    throw new QueryError(`At most ${MAX_ENTITY_IDS} ids per request; split the request`, ERROR_CODES.tooManyIds, 400);
  }
  return ids;
}

function parseBoolean(name: string, value: string): boolean {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new QueryError(`"${name}" must be true or false`, ERROR_CODES.invalidQuery);
}

const notFound = (message: string) => ({ error: { status: 404, code: ERROR_CODES.notFound, message } });

/**
 * The public REST API (WorkPlan §3.6, packages/api-contract/openapi.yaml). It has no database connections:
 * storage goes through the DAL, uploads through the ingestion service.
 */
export function registerApi(app: FastifyInstance, deps: ServerDeps): void {
  registerOpenApiDocs(app, OPENAPI_DOCS);

  const { dal, ingest, limits } = deps;
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
        error: { status, code: upstream?.code ?? ERROR_CODES.upstream, message: upstream?.message ?? err.message },
      });
    }
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({
      error: {
        status,
        code: err.code ?? ERROR_CODES.server,
        message: status >= 500 ? 'Internal server error' : err.message,
      },
    });
  });

  // Uploads are forwarded as raw text so the ingestion service decides about malformed JSON (-> 401).
  app.register(async (scope) => {
    scope.addContentTypeParser(
      CONTENT_TYPE_JSON,
      { parseAs: 'string', bodyLimit: deps.maxUploadBytes },
      (_r, body, done) => done(null, body),
    );
    scope.post<{ Querystring: { name?: string }; Body: string | undefined }>('/graphs', async (req, reply) => {
      const outcome = await ingest.ingest(req.body ?? '', req.query.name);
      return reply.code(outcome.status).send(outcome.body);
    });
  });

  app.get('/graphs', async () => dal.listGraphs());

  app.get<{ Params: { graphId: string } }>('/graphs/:graphId', async (req, reply) => {
    const graph = await dal.getGraph(req.params.graphId);
    return graph ?? reply.code(404).send(notFound('Graph not found'));
  });

  app.delete<{ Params: { graphId: string } }>('/graphs/:graphId', async (req, reply) => {
    if (!(await dal.getGraph(req.params.graphId))) return reply.code(404).send(notFound('Graph not found'));
    await dal.deleteGraph(req.params.graphId);
    return reply.code(204).send();
  });

  // Nodes and edges are fetched separately from the routes: a route lists ids only. Unknown ids are left out,
  // the others come back in the order requested.
  app.get<{ Params: { graphId: string }; Querystring: { id?: string | string[] } }>(
    '/graphs/:graphId/nodes',
    async (req, reply) => {
      const asked = entityIds(req.query.id);
      if (!(await dal.getGraph(req.params.graphId))) return reply.code(404).send(notFound('Graph not found'));
      // without ids: every node of the graph
      const wanted = asked.length > 0 ? asked : (await dal.topology(req.params.graphId)).nodes.map((n) => n.id);
      const { nodes } = await dal.entities(req.params.graphId, { nodeIds: wanted, edgeIds: [] });
      const byId = new Map(nodes.map((n) => [n.id, n]));
      return wanted.flatMap((id) => byId.get(id) ?? []);
    },
  );

  app.get<{ Params: { graphId: string }; Querystring: { id?: string | string[] } }>(
    '/graphs/:graphId/edges',
    async (req, reply) => {
      const asked = entityIds(req.query.id);
      if (!(await dal.getGraph(req.params.graphId))) return reply.code(404).send(notFound('Graph not found'));
      // without ids: every edge of the graph
      const wanted =
        asked.length > 0 ? asked : (await dal.topology(req.params.graphId)).edges.map(([from, to]) => edgeId(from, to));
      const { edges } = await dal.entities(req.params.graphId, { nodeIds: [], edgeIds: wanted });
      const byId = new Map(edges.map((e) => [e.id, e]));
      return wanted.flatMap((id) => byId.get(id) ?? []);
    },
  );

  app.get<{ Params: { graphId: string } }>('/graphs/:graphId/schema', async (req, reply) => {
    const schema = await getSchema(queryDeps, req.params.graphId);
    return schema ?? reply.code(404).send(notFound('Graph not found'));
  });

  app.get<{ Params: { graphId: string }; Querystring: { pin?: string; limit?: string } }>(
    '/graphs/:graphId/view',
    async (req, reply) => {
      if (!(await dal.getGraph(req.params.graphId))) return reply.code(404).send(notFound('Graph not found'));
      const pins = req.query.pin ? req.query.pin.split(',').filter(Boolean) : [];
      const cap = req.query.limit ? Number(req.query.limit) : undefined;
      return getView({ dal }, req.params.graphId, { pins, cap: Number.isFinite(cap) ? cap : undefined });
    },
  );

  app.post<{ Params: { graphId: string }; Body: ExpandRequest }>('/graphs/:graphId/view/expand', async (req, reply) => {
    if (!(await dal.getGraph(req.params.graphId))) return reply.code(404).send(notFound('Graph not found'));
    const body = req.body;
    if (
      !body ||
      typeof body.nodeId !== 'string' ||
      !Array.isArray(body.visible) ||
      !['neighbors', 'component'].includes(body.mode)
    ) {
      throw new QueryError(
        'Expected { nodeId, mode: "neighbors" | "component", visible: [{id,x,y}] }',
        ERROR_CODES.invalidRequest,
        400,
      );
    }
    return expandView({ dal }, req.params.graphId, body);
  });

  // The query travels in the URL (GET), so a query can be bookmarked, shared and seen in the browser's address bar.
  app.get<{
    Params: { graphId: string };
    Querystring: { q?: string; limit?: string; maxHops?: string; routeMode?: string; includeSubRoutes?: string };
  }>('/graphs/:graphId/routes/query', async (req) => {
    const { q, limit, maxHops, routeMode, includeSubRoutes } = req.query;
    if (q === undefined || q === '') {
      throw new QueryError('Missing "q": the query as JSON (a set tree)', ERROR_CODES.missingQuery, 400);
    }
    let query: unknown;
    try {
      query = JSON.parse(q);
    } catch {
      throw new QueryError('"q" is not valid JSON', ERROR_CODES.invalidQueryParam, 400);
    }
    return runQuery(queryDeps, req.params.graphId, {
      query,
      ...(limit !== undefined && { limit: Number(limit) }),
      ...(maxHops !== undefined && { maxHops: Number(maxHops) }),
      ...(routeMode !== undefined && { routeMode }),
      ...(includeSubRoutes !== undefined && { includeSubRoutes: parseBoolean('includeSubRoutes', includeSubRoutes) }),
    });
  });

  // Reserved: connecting segmented graphs (WorkPlan A9).
  const linksReserved = async (_req: unknown, reply: FastifyReply) =>
    reply
      .code(501)
      .send({ error: { status: 501, code: ERROR_CODES.notImplemented, message: 'Linking graphs is reserved' } });
  app.get('/graphs/:graphId/links', linksReserved);
  app.post('/graphs/:graphId/links', linksReserved);

  // an unknown path or method answers in the API's error format too
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({
      error: {
        status: 404,
        code: ERROR_CODES.routeNotFound,
        message: `No such operation: ${req.method} ${req.url.split('?')[0]}`,
      },
    }),
  );

  app.get('/health', async () => {
    const [d, i] = await Promise.all([dal.health().catch(() => null), ingest.health().catch(() => null)]);
    return {
      status: d?.status === HEALTH.ok && i?.status === HEALTH.ok ? HEALTH.ok : HEALTH.degraded,
      dal: d?.status ?? HEALTH.unreachable,
      ingest: i?.status ?? HEALTH.unreachable,
    };
  });
}
