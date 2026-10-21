import { fixture, sampleGraph } from '../setup/fixtures';
import { createStack, type Stack, type Json } from '../setup/stack';

let stack: Stack;
beforeAll(async () => {
  stack = await createStack();
});
afterAll(async () => {
  await stack.close();
});

describe('POST /graphs: upload outcomes (WorkPlan A6.1)', () => {
  it('201: a complete graph is stored and described', async () => {
    const res = await stack.upload(fixture('security.json'), 'security-demo');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'security-demo',
      status: 'complete',
      counts: { nodes: 9, edges: 8, placeholders: 0 },
      warnings: [],
      pinned: false,
      existing: false,
    });
    expect(res.body.graphId).toMatch(/^[0-9a-f]{16}$/);
    expect(res.body.results).toBeUndefined();
    expect(res.body.expiresAt).toBeGreaterThan(Date.now());
  });

  it('207: missing nodes are derived from the referencing edges and reported as 422 entries', async () => {
    const res = await stack.upload(sampleGraph());
    expect(res.status).toBe(207);
    expect(res.body).toMatchObject({
      status: 'incomplete',
      counts: { nodes: 47, edges: 98, placeholders: 1 },
    });
    expect(res.body.results).toEqual([
      expect.objectContaining({ status: 422, code: 'MISSING_NODE', ref: 'assurance-service' }),
    ]);
    expect(res.body.results[0].message).toContain('assurance-service');
    expect(res.body.warnings.map((w: { code: string }) => w.code)).toEqual(['MISSING_NODE']);
    // the graph is usable: the placeholder is part of it
    const view = await stack.api.request<Json>('GET', `/graphs/${res.body.graphId}/view`);
    const ghost = view.body.nodes.find((n: Json) => n.node.id === 'assurance-service');
    expect(ghost.node).toMatchObject({ incomplete: true, kind: 'unknown' });
  });

  it('is idempotent: the same content gives the same graph id and is reported as existing', async () => {
    const first = await stack.upload(fixture('security.json'));
    const second = await stack.upload({ ...fixture('security.json') });
    expect(second.body.graphId).toBe(first.body.graphId);
    expect(second.body.existing).toBe(true);
    const all = await stack.api.request<Json[]>('GET', '/graphs');
    expect(all.body.filter((g) => g.graphId === first.body.graphId)).toHaveLength(1);
  });

  it('gives different ids to different content, and defaults the name to the id prefix', async () => {
    const a = await stack.upload(fixture('cyclic.json'));
    const b = await stack.upload(fixture('security.json'));
    expect(a.body.graphId).not.toBe(b.body.graphId);
    expect(a.body.name).toBe(a.body.graphId.slice(0, 8));
  });

  it('warns about cycles without rejecting the graph', async () => {
    const res = await stack.upload(fixture('cyclic.json'));
    expect(res.status).toBe(201);
    expect(res.body.warnings.filter((w: { code: string }) => w.code === 'CYCLE')).toHaveLength(2);
  });

  it('401: malformed JSON', async () => {
    const res = await stack.api.request<Json>('POST', '/graphs', { body: '{"nodes": [' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ status: 401, code: 'INVALID_GRAPH' });
    expect(res.body.error.message).toContain('not valid JSON');
  });

  it('401: a graph in an invalid format lists the problems', async () => {
    const res = await stack.upload({ nodes: [{ kind: 'service' }], edges: [{ from: 'a', to: 3 }] });
    expect(res.status).toBe(401);
    expect(res.body.error.issues.length).toBeGreaterThanOrEqual(2);
    expect(res.body.error.issues[0].path).toBe('nodes.0.name');
  });

  it('401: duplicate node names are erroneous', async () => {
    const res = await stack.upload({ nodes: [{ name: 'a' }, { name: 'A' }] });
    expect(res.status).toBe(401);
    expect(res.body.error.issues[0].message).toContain('DUPLICATE_NODE_NAME');
  });

  it('401: an empty body', async () => {
    const res = await stack.api.request<Json>('POST', '/graphs');
    expect(res.status).toBe(401);
  });

  it('nothing is stored for rejected uploads', async () => {
    const before = (await stack.api.request<Json[]>('GET', '/graphs')).body.length;
    await stack.upload({ nodes: [{ name: 'dup' }, { name: 'dup' }] });
    expect((await stack.api.request<Json[]>('GET', '/graphs')).body).toHaveLength(before);
  });
});

describe('uploads above the size limit', () => {
  it('413', async () => {
    const small = await createStack({ maxUploadBytes: 2000 });
    try {
      const res = await small.api.request<Json>('POST', '/graphs', { body: sampleGraph() });
      expect(res.status).toBe(413);
    } finally {
      await small.close();
    }
  });
});

describe('graph resources', () => {
  it('GET /graphs/:id returns the summary, 404 for unknown graphs', async () => {
    const id = await stack.uploadOk(fixture('security.json'));
    const found = await stack.api.request<Json>('GET', `/graphs/${id}`);
    expect(found.status).toBe(200);
    expect(found.body.graphId).toBe(id);
    expect((await stack.api.request<Json>('GET', '/graphs/0000000000000000')).status).toBe(404);
  });

  it('DELETE removes the graph, its data and its cache; a second delete is a 404', async () => {
    const id = await stack.uploadOk({
      nodes: [{ name: 'temp-a' }, { name: 'temp-b' }],
      edges: [{ from: 'temp-a', to: 'temp-b' }],
    });
    await stack.api.request('GET', `/graphs/${id}/schema`); // warm the cache
    const del = await stack.api.request('DELETE', `/graphs/${id}`);
    expect(del.status).toBe(204);
    expect((await stack.api.request('GET', `/graphs/${id}`)).status).toBe(404);
    expect((await stack.api.request('GET', `/graphs/${id}/schema`)).status).toBe(404);
    expect((await stack.api.request('GET', `/graphs/${id}/view`)).status).toBe(404);
    expect(
      (await stack.query(id, { query: { op: 'leaf', builder: { type: 'group', combinator: 'and', rules: [] } } }))
        .status,
    ).toBe(404);
    expect((await stack.api.request('DELETE', `/graphs/${id}`)).status).toBe(404);
    const topology = await stack.dal.engine.topology(id);
    expect(topology.nodes).toEqual([]); // no orphaned nodes left in Neo4j
  });

  it('reserved endpoint for segmented graphs answers 501', async () => {
    const res = await stack.api.request<Json>('POST', '/graphs/abc/links', { body: {} });
    expect(res.status).toBe(501);
  });

  it('GET /health reports the services', async () => {
    const res = await stack.api.request<Json>('GET', '/health');
    expect(res.body).toEqual({ status: 'ok', dal: 'ok', ingest: 'ok' });
  });
});

describe('GET /graphs/:id/schema (feeds the builder and the renderer)', () => {
  it('lists kinds with distinct colours, properties, sink kinds and the severity scale', async () => {
    const id = await stack.uploadOk(sampleGraph());
    const res = await stack.api.request<Json>('GET', `/graphs/${id}/schema`);
    expect(res.status).toBe(200);
    const kinds = Object.fromEntries(res.body.kinds.map((k: Json) => [k.kind, k.color]));
    expect(Object.keys(kinds).sort()).toEqual(['rds', 'service', 'sqs', 'unknown']);
    expect(new Set(Object.values(kinds)).size).toBe(4);
    for (const color of Object.values(kinds)) expect(color).toMatch(/^#[0-9a-f]{6}$/);
    expect(res.body.properties.find((p: Json) => p.path === 'vulnerabilities.severity')).toMatchObject({ list: true });
    expect(res.body.sinkKinds).toEqual(['rds', 'sqs']);
    expect(res.body.severityScale.high).toBe(3);
  });

  it('uses the same colour for a kind in every graph (global, append-only map)', async () => {
    const a = await stack.uploadOk(sampleGraph());
    const b = await stack.uploadOk(fixture('security.json'));
    const color = async (id: string, kind: string) =>
      (await stack.api.request<Json>('GET', `/graphs/${id}/schema`)).body.kinds.find((k: Json) => k.kind === kind)
        .color;
    expect(await color(a, 'rds')).toBe(await color(b, 'rds'));
    expect(await color(a, 'service')).toBe(await color(b, 'service'));
  });

  it('rebuilds a missing schema artefact through the ingestion service (A14.4)', async () => {
    const id = await stack.uploadOk(fixture('security.json'));
    const before = (await stack.api.request<Json>('GET', `/graphs/${id}/schema`)).body;
    await stack.dalClient.cacheDelete(id);
    expect(await stack.dalClient.cacheGet(id, 'schema')).toBeNull();
    const rebuilt = await stack.api.request<Json>('GET', `/graphs/${id}/schema`);
    expect(rebuilt.status).toBe(200);
    expect(rebuilt.body).toEqual(before);
    expect(await stack.dalClient.cacheGet(id, 'schema')).not.toBeNull();
  });
});
