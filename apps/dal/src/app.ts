import Fastify, { type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { hashString, QueryError, type GraphEngine } from '@gd/query-core';
import type {
  EntitiesBody,
  HealthResponse,
  PutGraphBody,
  PutGraphResponse,
  RunBody,
  RunResponse,
} from '@gd/dal-contract';
import type { Topology } from '@gd/query-core';
import { Cache } from './cache';
import { ColorRegistry, MemoryColorStore, RedisColorStore } from './colors';
import type { DalConfig } from './config';
import { ExpirySweeper } from './expiry';
import { Lock } from './locks';

export interface DalDeps {
  engine: GraphEngine;
  redis: Redis | null;
  config: DalConfig;
  logger?: boolean;
}

export interface Dal {
  app: FastifyInstance;
  cache: Cache;
  sweeper: ExpirySweeper;
  colors: ColorRegistry;
  close(): Promise<void>;
}

const ARTIFACTS = new Set(['schema', 'topology', 'layout', 'view', 'q']);

/** Builds one DAL replica (WorkPlan §3.7): the only component that touches Neo4j and Redis. */
export function createDal({ engine, redis, config, logger = false }: DalDeps): Dal {
  const app = Fastify({ logger, bodyLimit: 256 * 1024 * 1024 });
  const log = { warn: (m: string) => app.log.warn(m) };
  const cache = new Cache(redis, config.cacheTtlSeconds, log);
  const colors = new ColorRegistry(redis ? new RedisColorStore(redis) : new MemoryColorStore());
  const sweeper = new ExpirySweeper(
    engine,
    cache,
    new Lock(redis, 'lock:expiry'),
    config.expirySweepIntervalSeconds,
    (e) => app.log.error(e),
  );

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof QueryError) {
      return reply.code(err.status).send({ error: { status: err.status, code: err.code, message: err.message } });
    }
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: { status, code: 'DAL_ERROR', message: err.message } });
  });

  app.get('/dal/health', async (): Promise<HealthResponse> => {
    let neo4j = true;
    try {
      await engine.ping();
    } catch {
      neo4j = false;
    }
    const redisOk = await cache.ping();
    return { status: neo4j && redisOk ? 'ok' : 'degraded', neo4j, redis: redisOk };
  });

  // ------------------------------------------------------------------ graphs
  app.put<{ Params: { id: string }; Body: PutGraphBody }>('/dal/graphs/:id', async (req, reply) => {
    const { id } = req.params;
    const { name, graph, warnings, pinned } = req.body;
    const expiresAt = pinned ? null : Date.now() + config.cacheTtlSeconds * 1000;
    const created = await engine.store({ graphId: id, name, graph, warnings, pinned, expiresAt });
    const summary = (await engine.getGraph(id))!;
    reply.code(created ? 201 : 200);
    return { created, summary } satisfies PutGraphResponse;
  });

  app.get('/dal/graphs', async () => engine.listGraphs());

  app.get<{ Params: { id: string } }>('/dal/graphs/:id', async (req, reply) => {
    const g = await engine.getGraph(req.params.id);
    if (!g)
      return reply.code(404).send({ error: { status: 404, code: 'GRAPH_NOT_FOUND', message: 'Graph not found' } });
    return g;
  });

  app.delete<{ Params: { id: string } }>('/dal/graphs/:id', async (req, reply) => {
    await engine.deleteGraph(req.params.id);
    await cache.deleteGraph(req.params.id);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string }; Body: RunBody }>('/dal/graphs/:id/run', async (req) => {
    const { query, limit, maxHops, timeoutMs } = req.body;
    const key = hashString(JSON.stringify([query.text, query.params, limit, maxHops]));
    const hit = await cache.get(req.params.id, 'q', key);
    if (hit) return { ...JSON.parse(hit), cached: true } as RunResponse;
    const result = await engine.run(req.params.id, query, {
      limit,
      maxHops,
      timeoutMs: timeoutMs ?? config.neo4jTxTimeoutMs,
    });
    await cache.put(req.params.id, 'q', JSON.stringify(result), key);
    return { ...result, cached: false } as RunResponse;
  });

  app.get<{ Params: { id: string } }>('/dal/graphs/:id/topology', async (req, reply) => {
    const hit = await cache.get(req.params.id, 'topology');
    if (hit) return reply.type('application/json').send(hit);
    if (!(await engine.getGraph(req.params.id))) {
      return reply.code(404).send({ error: { status: 404, code: 'GRAPH_NOT_FOUND', message: 'Graph not found' } });
    }
    const topology: Topology = await engine.topology(req.params.id);
    await cache.put(req.params.id, 'topology', JSON.stringify(topology));
    return topology;
  });

  app.post<{ Params: { id: string }; Body: EntitiesBody }>('/dal/graphs/:id/entities', async (req) =>
    engine.entities(req.params.id, req.body.nodeIds ?? [], req.body.edgeIds ?? []),
  );

  // ------------------------------------------------------------------- cache
  app.get<{ Params: { graphId: string; artifact: string }; Querystring: { key?: string } }>(
    '/dal/cache/:graphId/:artifact',
    async (req, reply) => {
      const hit = ARTIFACTS.has(req.params.artifact)
        ? await cache.get(req.params.graphId, req.params.artifact, req.query.key)
        : null;
      if (hit === null)
        return reply.code(404).send({ error: { status: 404, code: 'CACHE_MISS', message: 'Not cached' } });
      return reply.type('application/json').send(hit);
    },
  );

  app.put<{ Params: { graphId: string; artifact: string }; Querystring: { key?: string }; Body: unknown }>(
    '/dal/cache/:graphId/:artifact',
    async (req, reply) => {
      if (!ARTIFACTS.has(req.params.artifact)) {
        throw new QueryError(`Unknown artifact "${req.params.artifact}"`, 'UNKNOWN_ARTIFACT', 400);
      }
      await cache.put(req.params.graphId, req.params.artifact, JSON.stringify(req.body), req.query.key);
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { graphId: string } }>('/dal/cache/:graphId', async (req, reply) => {
    await cache.deleteGraph(req.params.graphId);
    return reply.code(204).send();
  });

  // ------------------------------------------------------------------ colours
  app.get('/dal/colors', async () => colors.all());
  app.post<{ Body: { kinds: string[] } }>('/dal/colors', async (req) => colors.assign(req.body?.kinds ?? []));

  // -------------------------------------------------------------- maintenance
  app.post('/dal/maintenance/expire', async () => sweeper.sweep());

  return {
    app,
    cache,
    sweeper,
    colors,
    async close() {
      sweeper.stop();
      await app.close();
    },
  };
}
