import { Redis } from 'ioredis';
import { injectTransport, type Transport } from '@gd/api-contract';
import { DalClient } from '@gd/dal-contract';
import { IngestClient } from '@gd/ingest-contract';
import { Neo4jEngine } from '@gd/engine-neo4j';
import { DEFAULT_CONFIG } from '@gd/graph-core';
import { createDal, type Dal } from '../../apps/dal/src/app';
import type { DalConfig } from '../../apps/dal/src/config';
import { createIngestApp } from '../../apps/ingest/src/app';
import { createServer } from '../../apps/server/src/app';

export { fixture, sampleGraph } from './fixtures';

/** Loosely typed JSON of API responses in tests (the shapes are asserted by the tests themselves). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export function testDalConfig(overrides: Partial<DalConfig> = {}): DalConfig {
  return {
    port: 0,
    neo4jUri: process.env.TEST_NEO4J_URI ?? 'bolt://127.0.0.1:7687',
    neo4jUser: 'neo4j',
    neo4jPassword: process.env.TEST_NEO4J_PASSWORD ?? 'graphdisplay-dev',
    redisUrl: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379',
    cacheTtlSeconds: 3600,
    expirySweepIntervalSeconds: 0, // sweeps are triggered explicitly in tests
    neo4jTxTimeoutMs: 8000,
    ...overrides,
  };
}

export interface DalInstance {
  dal: Dal;
  client: DalClient;
  engine: Neo4jEngine;
  redis: Redis;
  close(): Promise<void>;
}

/** One in-process DAL replica with its own Neo4j and Redis connections. */
export async function createDalInstance(overrides: Partial<DalConfig> = {}): Promise<DalInstance> {
  const config = testDalConfig(overrides);
  const engine = new Neo4jEngine({
    uri: config.neo4jUri,
    user: config.neo4jUser,
    password: config.neo4jPassword,
    defaultTimeoutMs: config.neo4jTxTimeoutMs,
  });
  await engine.init();
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
  const dal = createDal({ engine, redis, config });
  await dal.app.ready();
  return {
    dal,
    client: new DalClient(injectTransport(dal.app)),
    engine,
    redis,
    async close() {
      await dal.close();
      redis.disconnect();
      await engine.close();
    },
  };
}

export interface Stack {
  dal: DalInstance;
  dalClient: DalClient;
  ingestClient: IngestClient;
  /** The public API, called in-process. */
  api: Transport;
  /** Graph ids created through `upload`, deleted on close. */
  graphIds: string[];
  upload(graph: unknown, name?: string): Promise<{ status: number; body: Json }>;
  /** Uploads and returns the graph id (asserting a successful upload). */
  uploadOk(graph: unknown, name?: string): Promise<string>;
  query(graphId: string, body: unknown): Promise<{ status: number; body: Json }>;
  close(): Promise<void>;
}

/** Server + ingestion service + DAL wired in-process (WorkPlan D3), on the real Neo4j and Redis. */
export async function createStack(
  opts: { dal?: Partial<DalConfig>; maxUploadBytes?: number; maxHops?: number; defaultLimit?: number } = {},
): Promise<Stack> {
  const dal = await createDalInstance(opts.dal);
  const maxUploadBytes = opts.maxUploadBytes ?? 50 * 1024 * 1024;
  const ingestApp = createIngestApp({ dal: dal.client, config: DEFAULT_CONFIG, maxUploadBytes });
  await ingestApp.ready();
  const ingestClient = new IngestClient(injectTransport(ingestApp));
  const server = createServer({
    dal: dal.client,
    ingest: ingestClient,
    limits: { maxHops: opts.maxHops ?? 50, defaultLimit: opts.defaultLimit ?? 1000 },
    maxUploadBytes,
  });
  await server.ready();
  const api = injectTransport(server);
  const graphIds: string[] = [];

  const upload = async (graph: unknown, name?: string) => {
    const res = await api.request<Json>('POST', '/graphs', { body: graph, query: { name } });
    if (res.body?.graphId && !graphIds.includes(res.body.graphId)) graphIds.push(res.body.graphId);
    return res;
  };
  return {
    dal,
    dalClient: dal.client,
    ingestClient,
    api,
    graphIds,
    upload,
    async uploadOk(graph, name) {
      const res = await upload(graph, name);
      if (![201, 207].includes(res.status)) throw new Error(`upload failed: ${res.status} ${JSON.stringify(res.body)}`);
      return res.body.graphId as string;
    },
    query: (graphId, body) => api.request<Json>('POST', `/graphs/${graphId}/routes/query`, { body }),
    async close() {
      for (const id of graphIds) await dal.client.deleteGraph(id).catch(() => undefined);
      await server.close();
      await ingestApp.close();
      await dal.close();
    },
  };
}

/** Builder-leaf helpers for readable tests. */
export const rule = (position: string, path: string, op: string, value?: unknown) => ({
  type: 'rule',
  position,
  path,
  op,
  ...(value === undefined ? {} : { value }),
});
export const group = (combinator: 'and' | 'or', ...rules: unknown[]) => ({ type: 'group', combinator, rules });
export const leaf = (...rules: unknown[]) => ({ op: 'leaf', builder: group('and', ...rules) });
export const names = (res: { body: { routes: { nodeIds: string[] }[] } }) =>
  res.body.routes.map((r) => r.nodeIds.join('>')).sort();
