import { Redis } from 'ioredis';
import { Neo4jEngine } from '@gd/engine-neo4j';
import { DalClient } from '@gd/dal-contract';
import { injectTransport } from '@gd/api-contract';
import { DEFAULT_CONFIG, finalizeGraph, parseGraph } from '@gd/graph-core';
import type { NativeQuery } from '@gd/query-core';
import { createDal } from '../../apps/dal/src/app';
import { Lock } from '../../apps/dal/src/locks';
import { generateGraph } from '@gd/generator';
import { fixture } from '../setup/fixtures';
import { createDalInstance, testDalConfig, type DalInstance } from '../setup/stack';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const normalized = (input: unknown) => {
  const parsed = parseGraph(input);
  if (!parsed.ok) throw new Error('invalid test graph');
  return { graph: finalizeGraph(parsed.graph, DEFAULT_CONFIG).graph, warnings: parsed.warnings };
};
// unique graph content per call, so tests never collide with each other
let counter = 0;
const uniqueGraph = () =>
  normalized({
    nodes: [{ name: `dal-a-${Date.now()}-${counter++}` }, { name: 'dal-b' }],
    edges: [{ from: 'dal-b', to: 'dal-b' }],
  });
const idOf = () => `dal${Date.now().toString(16)}${(counter++).toString(16).padStart(4, '0')}`;
const keysOf = (redis: Redis, id: string) => redis.keys(`graph:${id}:*`);

let a: DalInstance;
let b: DalInstance;
const toDelete: string[] = [];

beforeAll(async () => {
  a = await createDalInstance();
  b = await createDalInstance();
});
afterAll(async () => {
  for (const id of toDelete) await a.client.deleteGraph(id);
  await a.close();
  await b.close();
});

const put = async (client: DalClient, id: string, opts: { pinned?: boolean; name?: string } = {}) => {
  const { graph, warnings } = uniqueGraph();
  toDelete.push(id);
  return client.putGraph(id, { name: opts.name ?? 'dal-test', graph, warnings, pinned: opts.pinned ?? false });
};

describe('store, pull and delete', () => {
  it('stores a graph, reads it back and lists it; storing again is idempotent', async () => {
    const id = idOf();
    const first = await put(a.client, id);
    expect(first.created).toBe(true);
    expect(first.summary).toMatchObject({
      graphId: id,
      name: 'dal-test',
      status: 'complete',
      counts: { nodes: 2, edges: 1 },
      pinned: false,
    });
    const second = await a.client.putGraph(id, {
      name: 'ignored',
      graph: uniqueGraph().graph,
      warnings: [],
      pinned: false,
    });
    expect(second.created).toBe(false);
    expect(second.summary.name).toBe('dal-test');
    expect((await a.client.getGraph(id))?.graphId).toBe(id);
    expect((await a.client.listGraphs()).filter((g) => g.graphId === id)).toHaveLength(1);
    expect(await a.client.getGraph('0000000000000000')).toBeNull();
  });

  it('any replica serves any request: a graph stored by one replica is read by the other', async () => {
    const id = idOf();
    await put(a.client, id);
    expect((await b.client.getGraph(id))?.graphId).toBe(id);
    expect((await b.client.topology(id)).nodes).toHaveLength(2);
  });

  it('delete removes Neo4j data and every cache key; deleting twice is harmless', async () => {
    const id = idOf();
    await put(a.client, id);
    await a.client.topology(id); // cached
    await a.client.cachePut(id, 'schema', { x: 1 });
    await a.client.cachePut(id, 'view', { y: 2 }, 'k1');
    expect((await keysOf(a.redis, id)).length).toBeGreaterThanOrEqual(4);

    await b.client.deleteGraph(id); // the other replica deletes
    expect(await a.client.getGraph(id)).toBeNull();
    expect(await keysOf(a.redis, id)).toEqual([]);
    expect((await a.engine.topology(id)).nodes).toEqual([]);
    await expect(a.client.deleteGraph(id)).resolves.toBeUndefined();
  });

  it('topology of an unknown graph is a 404', async () => {
    await expect(a.client.topology('0000000000000000')).rejects.toMatchObject({ status: 404 });
  });
});

describe('cache', () => {
  it('stores artefacts per graph and key, and returns null on a miss', async () => {
    const id = idOf();
    expect(await a.client.cacheGet(id, 'layout', 'v1')).toBeNull();
    await a.client.cachePut(id, 'layout', { n: 1 }, 'v1');
    await a.client.cachePut(id, 'layout', { n: 2 }, 'v2');
    expect(await b.client.cacheGet(id, 'layout', 'v1')).toEqual({ n: 1 });
    expect(await b.client.cacheGet(id, 'layout', 'v2')).toEqual({ n: 2 });
    expect(await b.client.cacheGet(id, 'layout')).toBeNull();
    await a.client.cacheDelete(id);
    expect(await a.client.cacheGet(id, 'layout', 'v1')).toBeNull();
  });

  it('rejects unknown artefact kinds', async () => {
    const res = await injectTransport(a.dal.app).request('PUT', '/dal/cache/g1/bogus', { body: {} });
    expect(res.status).toBe(400);
  });

  it('entries expire after the configured cache lifetime (default 1 day, configurable)', async () => {
    const short = await createDalInstance({ cacheTtlSeconds: 1 });
    try {
      const id = idOf();
      await short.client.cachePut(id, 'schema', { alive: true });
      expect(await short.client.cacheGet(id, 'schema')).toEqual({ alive: true });
      expect(await short.redis.ttl(`graph:${id}:schema`)).toBeLessThanOrEqual(1);
      await sleep(1300);
      expect(await short.client.cacheGet(id, 'schema')).toBeNull();
    } finally {
      await short.close();
    }
  });

  it('caches query results and serves them from the cache on repeat', async () => {
    const id = idOf();
    await put(a.client, id);
    const query: NativeQuery = {
      language: 'cypher',
      kind: 'raw',
      text: 'CALL { MATCH (n:Node {graphId: $g}) RETURN n } RETURN n AS r LIMIT 11',
      params: { g: id },
    };
    const first = await a.client.run(id, { query, limit: 10, maxHops: 5 });
    const second = await b.client.run(id, { query, limit: 10, maxHops: 5 });
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.routes).toEqual(first.routes);
    expect(first.routes).toHaveLength(2);
  });
});

describe('colour map (global, atomic)', () => {
  it('concurrent replicas assign every new kind one colour, all distinct', async () => {
    const kinds = Array.from({ length: 5 }, (_, i) => `dal-kind-${Date.now()}-${i}`);
    const [m1, m2] = await Promise.all([a.client.assignColors(kinds), b.client.assignColors([...kinds].reverse())]);
    for (const k of kinds) expect(m1[k]).toBe(m2[k]);
    const colors = kinds.map((k) => m1[k]);
    expect(new Set(colors).size).toBe(kinds.length);
    expect((await a.client.colors())[kinds[0]]).toBe(m1[kinds[0]]);
  });
});

describe('expiry (WorkPlan A7.1, A13.3)', () => {
  it('deletes expired graphs from Neo4j and Redis, but not pinned or still valid ones', async () => {
    const short = await createDalInstance({ cacheTtlSeconds: 1 });
    try {
      const expiring = idOf();
      const pinned = idOf();
      const valid = idOf();
      const { graph, warnings } = uniqueGraph();
      toDelete.push(expiring, pinned, valid);
      await short.client.putGraph(expiring, { name: 'e', graph, warnings, pinned: false });
      await short.client.putGraph(pinned, { name: 'p', graph: uniqueGraph().graph, warnings: [], pinned: true });
      await a.client.putGraph(valid, { name: 'v', graph: uniqueGraph().graph, warnings: [], pinned: false }); // 1h TTL
      await short.client.topology(expiring); // fill a cache entry
      expect((await short.client.getGraph(pinned))?.expiresAt).toBeNull();

      await sleep(1300);
      const result = await short.client.expire();
      expect(result.skipped).toBe(false);
      expect(result.deleted).toContain(expiring);
      expect(result.deleted).not.toContain(pinned);
      expect(result.deleted).not.toContain(valid);

      expect(await short.client.getGraph(expiring)).toBeNull();
      expect((await short.engine.topology(expiring)).nodes).toEqual([]);
      expect(await keysOf(short.redis, expiring)).toEqual([]);
      expect(await short.client.getGraph(pinned)).not.toBeNull();
      expect(await a.client.getGraph(valid)).not.toBeNull();
      expect((await short.client.expire()).deleted).toEqual([]);
    } finally {
      await short.close();
    }
  });

  it('only the replica holding the expiry lock sweeps; the other skips', async () => {
    const lock = new Lock(a.redis, 'lock:expiry');
    const token = await lock.acquire(10_000);
    expect(token).not.toBeNull();
    try {
      const skipped = await b.client.expire();
      expect(skipped).toMatchObject({ skipped: true, deleted: [] });
      expect(skipped.reason).toContain('lock');
    } finally {
      await lock.release(token!);
    }
    expect((await b.client.expire()).skipped).toBe(false);
  });

  it('two replicas sweeping at the same time never delete a graph twice', async () => {
    const short = await createDalInstance({ cacheTtlSeconds: 1 });
    const other = await createDalInstance({ cacheTtlSeconds: 1 });
    try {
      const ids = [idOf(), idOf(), idOf()];
      for (const id of ids) {
        toDelete.push(id);
        await short.client.putGraph(id, { name: 'x', graph: uniqueGraph().graph, warnings: [], pinned: false });
      }
      await sleep(1300);
      const [r1, r2] = await Promise.all([short.client.expire(), other.client.expire()]);
      const all = [...r1.deleted, ...r2.deleted].filter((id) => ids.includes(id));
      expect(all.sort()).toEqual([...ids].sort());
      expect(new Set(all).size).toBe(all.length);
      for (const id of ids) expect(await short.client.getGraph(id)).toBeNull();
    } finally {
      await short.close();
      await other.close();
    }
  });

  it('the lock is released after a sweep and expires on its own if a replica dies', async () => {
    await a.client.expire();
    expect(await a.redis.exists('lock:expiry')).toBe(0);
    const lock = new Lock(a.redis, 'lock:expiry');
    const token = await lock.acquire(300);
    expect(await lock.acquire(300)).toBeNull();
    expect(await lock.renew('wrong-token', 300)).toBe(false);
    await sleep(400);
    const next = await lock.acquire(300);
    expect(next).not.toBeNull();
    await lock.release(token!); // stale token: must not release the new holder's lock
    expect(await a.redis.exists('lock:expiry')).toBe(1);
    await lock.release(next!);
  });
});

describe('failure handling', () => {
  it('query time limit: 504 with a clear code', async () => {
    const quick = await createDalInstance({ neo4jTxTimeoutMs: 40 });
    const id = idOf();
    try {
      const dense = normalized(generateGraph({ seed: 4, nodes: 300, edges: 3500, layers: 6 }));
      toDelete.push(id);
      await quick.client.putGraph(id, { name: 'dense', graph: dense.graph, warnings: [], pinned: false });
      const query: NativeQuery = {
        language: 'cypher',
        kind: 'raw',
        text: 'CALL { MATCH p = (a:Node {graphId: $g})-[:CALLS*0..8]->(b:Node) RETURN p } RETURN p AS r LIMIT 1000000',
        params: { g: id },
      };
      await expect(quick.client.run(id, { query, limit: 1000, maxHops: 8 })).rejects.toMatchObject({
        status: 504,
        body: { error: { code: 'QUERY_TIMEOUT' } },
      });
    } finally {
      await quick.close();
    }
  });

  it('keeps working without Redis: cache reads miss, writes are skipped, health is degraded', async () => {
    const config = testDalConfig();
    const engine = new Neo4jEngine({ uri: config.neo4jUri, user: config.neo4jUser, password: config.neo4jPassword });
    const deadRedis = new Redis('redis://127.0.0.1:1', {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    deadRedis.on('error', () => undefined);
    const dal = createDal({ engine, redis: deadRedis, config });
    const client = new DalClient(injectTransport(dal.app));
    const id = idOf();
    try {
      toDelete.push(id);
      const { graph, warnings } = uniqueGraph();
      expect((await client.putGraph(id, { name: 'no-redis', graph, warnings, pinned: false })).created).toBe(true);
      await client.cachePut(id, 'schema', { a: 1 });
      expect(await client.cacheGet(id, 'schema')).toBeNull();
      expect((await client.topology(id)).nodes).toHaveLength(2);
      expect(await client.health()).toEqual({ status: 'degraded', neo4j: true, redis: false });
      await client.deleteGraph(id);
      expect(await client.getGraph(id)).toBeNull();
    } finally {
      await dal.close();
      deadRedis.disconnect();
      await engine.close();
    }
  });

  it('health is ok when both stores are reachable', async () => {
    expect(await a.client.health()).toEqual({ status: 'ok', neo4j: true, redis: true });
  });

  it('keeps a security fixture intact through the DAL (round trip of the stored graph)', async () => {
    const id = idOf();
    const { graph, warnings } = normalized(fixture('security.json'));
    toDelete.push(id);
    await a.client.putGraph(id, { name: 'sec', graph, warnings, pinned: false });
    const { nodes, edges } = await a.client.entities(id, {
      nodeIds: graph.nodes.map((n) => n.id),
      edgeIds: graph.edges.map((e) => e.id),
    });
    expect(nodes).toHaveLength(9);
    expect(edges).toHaveLength(8);
    expect(nodes.find((n) => n.id === 'ledger-db')).toMatchObject({ kind: 'rds', metadata: { engine: 'postgres' } });
  });
});
