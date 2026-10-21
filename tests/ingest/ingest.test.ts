import { join } from 'node:path';
import type { NativeQuery } from '@gd/query-core';
import { DEFAULT_CONFIG } from '@gd/graph-core';
import { rebuildSchema, runPipeline } from '../../apps/ingest/src/pipeline';
import { seedGraph } from '../../apps/ingest/src/seed';
import { fixture, sampleGraph } from '../setup/fixtures';
import { createDalInstance, type DalInstance } from '../setup/stack';

let dal: DalInstance;
const created: string[] = [];
const deps = () => ({ dal: dal.client, config: DEFAULT_CONFIG });

beforeAll(async () => {
  dal = await createDalInstance();
});
afterAll(async () => {
  for (const id of created) await dal.client.deleteGraph(id);
  await dal.close();
});

/** Runs a native Cypher query directly on the stored data. */
const cypher = async (graphId: string, text: string) => {
  const query: NativeQuery = { language: 'cypher', kind: 'raw', text, params: { g: graphId } };
  return (await dal.client.run(graphId, { query, limit: 100, maxHops: 50 })).routes
    .map((r) => r.nodeIds.join('>'))
    .sort();
};

describe('ingestion pipeline', () => {
  it('stores the normalised graph, its derived properties and the schema', async () => {
    const out = await runPipeline(JSON.stringify(fixture('security.json')), { name: 'sec' }, deps());
    expect(out.status).toBe(201);
    const id = (out.body as { graphId: string }).graphId;
    created.push(id);

    expect(await dal.client.cacheGet(id, 'schema')).toMatchObject({ graphId: id, nodeCount: 9, edgeCount: 8 });
    const topology = await dal.client.topology(id);
    expect(topology.nodes.map((n) => [n.id, n.degree])).toEqual([
      ['admin', 1],
      ['api', 4],
      ['billing', 3],
      ['events', 1],
      ['ledger-db', 1],
      ['lonely', 0],
      ['reports', 3],
      ['web', 1],
      ['worker', 2],
    ]);
    expect(topology.edges).toContainEqual(['api', 'billing']);
  });

  it('writes derived and flattened properties to the database', async () => {
    const id = created[0];
    expect(await cypher(id, 'MATCH (n:Node {graphId: $g, _isSink: true}) RETURN n AS r')).toEqual([
      'events',
      'ledger-db',
    ]);
    expect(await cypher(id, 'MATCH (n:Node {graphId: $g, _isTerminal: true}) RETURN n AS r')).toEqual([
      'events',
      'ledger-db',
      'lonely',
    ]);
    expect(
      await cypher(id, 'MATCH (n:Node {graphId: $g}) WHERE n.`vulnerabilities._maxSeverityRank` >= 3 RETURN n AS r'),
    ).toEqual(['billing']);
    expect(
      await cypher(
        id,
        "MATCH (n:Node {graphId: $g}) WHERE 'cwe-79: xss' IN n.`vulnerabilities.metadata.cwe` RETURN n AS r",
      ),
    ).toEqual(['reports']);
    expect(await cypher(id, 'MATCH (n:Node {graphId: $g}) WHERE n.`metadata.cloud` = "aws" RETURN n AS r')).toEqual([
      'events',
      'ledger-db',
    ]);
  });

  it('keeps the original node (casing, nested objects) available as returned data', async () => {
    const { nodes } = await dal.client.entities(created[0], { nodeIds: ['web', 'billing'], edgeIds: ['web->api'] });
    expect(nodes.find((n) => n.id === 'web')).toEqual({ id: 'web', name: 'Web', kind: 'Service', publicExposed: true });
    expect(nodes.find((n) => n.id === 'billing')!.vulnerabilities).toHaveLength(2);
  });

  it('answers 207 for the sample, with the missing node derived and stored as incomplete', async () => {
    const out = await runPipeline(sampleGraph(), {}, deps());
    expect(out.status).toBe(207);
    const id = (out.body as { graphId: string }).graphId;
    created.push(id);
    expect(await cypher(id, 'MATCH (n:Node {graphId: $g, incomplete: true}) RETURN n AS r')).toEqual([
      'assurance-service',
    ]);
    const { nodes } = await dal.client.entities(id, { nodeIds: ['assurance-service'], edgeIds: [] });
    expect(nodes[0]).toEqual({ id: 'assurance-service', name: 'assurance-service', kind: 'unknown', incomplete: true });
  });

  it('does not touch the database when the input is invalid', async () => {
    const before = (await dal.client.listGraphs()).length;
    for (const input of ['not json', { nodes: 'x' }, { nodes: [{ name: 'a' }, { name: 'a' }] }, undefined, '']) {
      const out = await runPipeline(input, {}, deps());
      expect(out.status).toBe(401);
    }
    expect(await dal.client.listGraphs()).toHaveLength(before);
  });

  it('produces the same graph id for the same content, whatever the key order or whitespace', async () => {
    const a = await runPipeline(
      { nodes: [{ name: 'x', kind: 'service', a: 1 }, { name: 'y' }], edges: [{ from: 'x', to: 'y' }] },
      {},
      deps(),
    );
    const b = await runPipeline(
      ' { "edges": [{"to": ["y"], "from": "X"}], "nodes": [{"name": " y "}, {"a": 1, "kind": "service", "name": "x"}] } ',
      {},
      deps(),
    );
    const idA = (a.body as { graphId: string }).graphId;
    created.push(idA);
    expect(b.body as { graphId: string; existing?: boolean }).toMatchObject({ graphId: idA, existing: true });
  });

  it('the graph id depends on the content and the derived-property settings only, not on other service settings', async () => {
    const content = { nodes: [{ name: `cfg-${Date.now()}` }] };
    const base = await runPipeline(content, {}, deps());
    const id = (base.body as { graphId: string }).graphId;
    created.push(id);
    const noisy = { ...DEFAULT_CONFIG, port: 1234, dalUrl: 'http://elsewhere', seedName: 'other' };
    const same = await runPipeline(content, {}, { dal: dal.client, config: noisy as never });
    expect(same.body).toMatchObject({ graphId: id, existing: true });
    // changing a setting that affects derived properties does give a different graph
    const other = await runPipeline(
      content,
      {},
      { dal: dal.client, config: { ...DEFAULT_CONFIG, sinkKinds: ['rds'] } },
    );
    const otherId = (other.body as { graphId: string }).graphId;
    created.push(otherId);
    expect(otherId).not.toBe(id);
  });

  it('the kind colours are registered globally when a graph is ingested', async () => {
    const colors = await dal.client.colors();
    expect(colors.service).toMatch(/^#/);
    expect(colors.rds).toMatch(/^#/);
    expect(colors.sqs).toMatch(/^#/);
  });
});

describe('seeding (WorkPlan A11)', () => {
  it('pinning an existing graph makes it exempt from expiry', async () => {
    const content = { nodes: [{ name: `pin-${Date.now()}` }] };
    const normal = await runPipeline(content, { pinned: false }, deps());
    const id = (normal.body as { graphId: string; pinned: boolean; expiresAt: number }).graphId;
    created.push(id);
    expect(normal.body).toMatchObject({ pinned: false });
    const pinned = await runPipeline(content, { pinned: true }, deps());
    expect(pinned.body).toMatchObject({ graphId: id, existing: true, pinned: true, expiresAt: null });
    // a later unpinned upload of the same content must not unpin it again
    const again = await runPipeline(content, { pinned: false }, deps());
    expect(again.body).toMatchObject({ graphId: id, pinned: true, expiresAt: null });
  });

  it('reads the file and runs the same pipeline; the seeded graph is pinned and re-seeding is idempotent', async () => {
    const file = join(__dirname, '..', '..', 'train-ticket-be.json');
    // start from a clean slate: the same content was stored (unpinned) by an earlier test
    for (const g of await dal.client.listGraphs()) {
      if (g.counts.nodes === 47 && g.counts.edges === 98) await dal.client.deleteGraph(g.graphId);
    }
    const first = await seedGraph(deps(), { file, pinned: true, attempts: 3, delayMs: 100 });
    const body = first.body as { graphId: string; pinned: boolean; expiresAt: number | null; name: string };
    created.push(body.graphId);
    expect(first.status).toBe(207);
    expect(body).toMatchObject({ pinned: true, expiresAt: null, name: 'train-ticket-be' });

    const again = await seedGraph(deps(), { file, pinned: true, attempts: 3, delayMs: 100 });
    expect(again.body as { graphId: string; existing: boolean }).toMatchObject({
      graphId: body.graphId,
      existing: true,
    });
    expect((await dal.client.listGraphs()).filter((g) => g.graphId === body.graphId)).toHaveLength(1);
  });

  it('gives up with a clear error when the DAL never becomes healthy', async () => {
    const broken = { ...deps(), dal: { health: async () => ({ status: 'degraded' }) } as never };
    await expect(seedGraph(broken, { file: 'x', pinned: false, attempts: 2, delayMs: 5 })).rejects.toThrow(
      'DAL did not become healthy',
    );
  });
});

describe('schema rebuild (WorkPlan A14.4)', () => {
  it('recomputes the schema from the stored data, identical to the original', async () => {
    const id = created[0];
    const original = await dal.client.cacheGet(id, 'schema');
    await dal.client.cacheDelete(id);
    const result = await rebuildSchema(id, deps());
    expect(result).toEqual({ graphId: id, rebuilt: ['schema'] });
    expect(await dal.client.cacheGet(id, 'schema')).toEqual(original);
  });

  it('rebuilds the schema of a graph with a placeholder node too', async () => {
    const id = created[1];
    const original = await dal.client.cacheGet<{ kinds: { kind: string }[] }>(id, 'schema');
    await dal.client.cacheDelete(id);
    await rebuildSchema(id, deps());
    const rebuilt = await dal.client.cacheGet<{ kinds: { kind: string }[] }>(id, 'schema');
    expect(rebuilt).toEqual(original);
    expect(rebuilt!.kinds.map((k) => k.kind)).toContain('unknown');
  });

  it('returns null for an unknown graph', async () => {
    expect(await rebuildSchema('ffffffffffffffff', deps())).toBeNull();
  });
});
