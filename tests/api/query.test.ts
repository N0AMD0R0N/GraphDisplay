import { fixture, sampleGraph } from '../setup/fixtures';
import { createStack, group, leaf, names, rule, type Stack, type Json } from '../setup/stack';

let stack: Stack;
let security: string;
let cyclic: string;
let sample: string;

beforeAll(async () => {
  stack = await createStack();
  security = await stack.uploadOk(fixture('security.json'));
  cyclic = await stack.uploadOk(fixture('cyclic.json'));
  sample = await stack.uploadOk(sampleGraph());
});
afterAll(async () => {
  await stack.close();
});

const run = (graphId: string, query: unknown, extra: object = {}) => stack.query(graphId, { query, ...extra });
const raw = (text: string) => ({ op: 'leaf', text });

describe('route queries on the security fixture: the primary filters (WorkPlan §3.9)', () => {
  it('returns all 30 routes (sub-paths), longest first, ties by node ids', async () => {
    const res = await run(security, leaf());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 30, truncated: false, warnings: [] });
    expect(res.body.routes[0].nodeIds).toEqual(['web', 'api', 'worker', 'billing', 'ledger-db']);
    const lengths = res.body.routes.map((r: Json) => r.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
    // the four 4-node routes follow, ordered by their node ids
    expect(res.body.routes.slice(1, 5).map((r: Json) => r.nodeIds.join('>'))).toEqual([
      'api>worker>billing>ledger-db',
      'web>api>billing>ledger-db',
      'web>api>reports>events',
      'web>api>worker>billing',
    ]);
  });

  it('"starts in a public service": 20 routes, all starting at web, api or admin', async () => {
    const res = await run(security, leaf(rule('first', 'publicExposed', 'eq', true)));
    expect(res.body.total).toBe(20);
    expect(new Set(res.body.routes.map((r: Json) => r.nodeIds[0]))).toEqual(new Set(['web', 'api', 'admin']));
  });

  it('"ends in a sink": 12 routes ending at ledger-db or events', async () => {
    const res = await run(security, leaf(rule('last', '_isSink', 'eq', true)));
    expect(res.body.total).toBe(12);
    expect(new Set(res.body.routes.map((r: Json) => r.nodeIds.at(-1)))).toEqual(new Set(['ledger-db', 'events']));
  });

  it('"ends in an rds or sql datastore" by kind', async () => {
    const res = await run(security, leaf(rule('last', 'kind', 'eq', 'rds')));
    expect(res.body.total).toBe(7);
  });

  it('public entry to sink: exactly the 7 expected routes', async () => {
    const res = await run(
      security,
      leaf(rule('first', 'publicExposed', 'eq', true), rule('last', '_isSink', 'eq', true)),
    );
    expect(names(res)).toEqual(
      [
        'admin>reports>events',
        'api>billing>ledger-db',
        'api>reports>events',
        'api>worker>billing>ledger-db',
        'web>api>billing>ledger-db',
        'web>api>reports>events',
        'web>api>worker>billing>ledger-db',
      ].sort(),
    );
  });

  it('"has any vulnerability": routes through billing or reports (20)', async () => {
    const res = await run(security, leaf(rule('any', 'vulnerabilities._count', 'gt', 0)));
    expect(res.body.total).toBe(20);
    for (const r of res.body.routes)
      expect(r.nodeIds.some((id: string) => ['billing', 'reports'].includes(id))).toBe(true);
  });

  it('by severity, case-insensitively: high -> billing only; medium -> reports only', async () => {
    const high = await run(security, leaf(rule('any', 'vulnerabilities.severity', 'eq', 'HIGH')));
    expect(high.body.total).toBe(12);
    for (const r of high.body.routes) expect(r.nodeIds).toContain('billing');
    const medium = await run(security, leaf(rule('any', 'vulnerabilities.severity', 'eq', 'medium')));
    expect(medium.body.total).toBe(8);
    for (const r of medium.body.routes) expect(r.nodeIds).toContain('reports');
  });

  it('by minimum severity rank: >= 2 (medium) matches billing (high) and reports (medium)', async () => {
    const res = await run(security, leaf(rule('any', 'vulnerabilities._maxSeverityRank', 'gte', 2)));
    expect(res.body.total).toBe(20);
    const high = await run(security, leaf(rule('any', 'vulnerabilities._maxSeverityRank', 'gte', 3)));
    expect(high.body.total).toBe(12);
  });

  it('by a specific vulnerability (CWE), whatever the case typed', async () => {
    const sql = await run(security, leaf(rule('any', 'vulnerabilities.metadata.cwe', 'contains', 'CWE-89')));
    expect(sql.body.total).toBe(12);
    const xss = await run(security, leaf(rule('any', 'vulnerabilities.metadata.cwe', 'contains', 'xss')));
    expect(xss.body.total).toBe(8);
    const none = await run(security, leaf(rule('any', 'vulnerabilities.metadata.cwe', 'contains', 'CWE-999')));
    expect(none.body).toMatchObject({ total: 0, routes: [], truncated: false });
  });

  it('public entry -> high-severity vulnerability -> sink: 4 routes, all through billing', async () => {
    const res = await run(
      security,
      leaf(
        rule('first', 'publicExposed', 'eq', true),
        rule('any', 'vulnerabilities._maxSeverityRank', 'gte', 3),
        rule('last', '_isSink', 'eq', true),
      ),
    );
    expect(names(res)).toEqual(
      [
        'api>billing>ledger-db',
        'api>worker>billing>ledger-db',
        'web>api>billing>ledger-db',
        'web>api>worker>billing>ledger-db',
      ].sort(),
    );
  });
});

describe('route queries: other rules and modes', () => {
  it('filters by route length (node count)', async () => {
    expect((await run(security, leaf({ type: 'length', min: 5 }))).body.total).toBe(1);
    expect((await run(security, leaf({ type: 'length', max: 1 }))).body.total).toBe(9);
    expect((await run(security, leaf({ type: 'length', min: 2, max: 2 }))).body.total).toBe(8);
  });

  it('supports all / none positions', async () => {
    expect((await run(security, leaf(rule('none', '_isSink', 'eq', true)))).body.total).toBe(18);
    expect((await run(security, leaf(rule('all', 'kind', 'eq', 'service')))).body.total).toBe(18);
    expect((await run(security, leaf(rule('first', 'kind', 'eq', 'Service')))).body.total).toBe(28);
  });

  it('supports in / neq / exists / startsWith', async () => {
    expect((await run(security, leaf(rule('first', 'name', 'in', ['web', 'admin'])))).body.total).toBe(12);
    expect((await run(security, leaf(rule('first', 'name', 'startsWith', 'LED')))).body.total).toBe(1);
    expect((await run(security, leaf(rule('first', 'kind', 'neq', 'service')))).body.total).toBe(2);
    // missing property is not "false": the datastores have no publicExposed property at all
    expect((await run(security, leaf(rule('first', 'publicExposed', 'notExists')))).body.total).toBe(2);
    expect((await run(security, leaf(rule('first', 'publicExposed', 'eq', false)))).body.total).toBe(8);
  });

  it('supports nested AND / OR groups', async () => {
    const res = await run(security, {
      op: 'leaf',
      builder: group(
        'and',
        group('or', rule('first', 'name', 'eq', 'web'), rule('first', 'name', 'eq', 'admin')),
        rule('last', '_isSink', 'eq', true),
      ),
    });
    expect(names(res)).toEqual(
      [
        'admin>reports>events',
        'web>api>billing>ledger-db',
        'web>api>reports>events',
        'web>api>worker>billing>ledger-db',
      ].sort(),
    );
  });

  it('maximal mode returns only source-to-sink routes (5, including the isolated node)', async () => {
    const res = await run(security, leaf(), { routeMode: 'maximal' });
    expect(names(res)).toEqual(
      [
        'admin>reports>events',
        'lonely',
        'web>api>billing>ledger-db',
        'web>api>reports>events',
        'web>api>worker>billing>ledger-db',
      ].sort(),
    );
  });

  it('honours a per-request hop limit', async () => {
    expect((await run(security, leaf(), { maxHops: 1 })).body.total).toBe(17);
    expect((await run(security, leaf(), { maxHops: 3 })).body.routes.every((r: Json) => r.length <= 4)).toBe(true);
  });

  it('truncates at the requested limit, keeps the longest routes and says so', async () => {
    const res = await run(security, leaf(), { limit: 5 });
    expect(res.body.routes).toHaveLength(5);
    expect(res.body).toMatchObject({ truncated: true, total: null });
    expect(res.body.warnings).toEqual([expect.objectContaining({ code: 'TRUNCATED' })]);
    expect(res.body.routes[0].nodeIds).toHaveLength(5);
    const exact = await run(security, leaf(), { limit: 30 });
    expect(exact.body).toMatchObject({ truncated: false, total: 30 });
  });

  it('returns the route payload: ordered node and edge ids, full original properties, normalised edges', async () => {
    const res = await run(
      security,
      leaf(rule('first', 'name', 'eq', 'web'), rule('last', 'name', 'eq', 'ledger-db'), {
        type: 'length',
        min: 4,
        max: 4,
      }),
    );
    expect(res.body.routes).toHaveLength(1);
    const route = res.body.routes[0];
    expect(route).toMatchObject({
      nodeIds: ['web', 'api', 'billing', 'ledger-db'],
      edgeIds: ['web->api', 'api->billing', 'billing->ledger-db'],
      length: 4,
    });
    expect(route.id).toMatch(/^[0-9a-f]{14}$/);
    expect(route.closesTo).toBeUndefined();
    // full original properties (original casing, trimmed strings), plus the generated id
    expect(res.body.nodes.web).toEqual({ id: 'web', name: 'Web', kind: 'Service', publicExposed: true });
    expect(res.body.nodes.billing.vulnerabilities[0]).toEqual({
      file: 'billing/Pay.java',
      severity: 'HIGH',
      message: 'SQL concatenation',
      metadata: { cwe: 'CWE-89: SQL Injection' },
    });
    expect(res.body.nodes['ledger-db'].metadata).toEqual({ cloud: 'AWS', engine: 'postgres' });
    // edges are normalised: one object per edge, not the grouped input form
    expect(res.body.edges['api->billing']).toEqual({ id: 'api->billing', from: 'api', to: 'billing' });
    expect(Object.keys(res.body.nodes).sort()).toEqual(['api', 'billing', 'ledger-db', 'web']);
  });
});

describe('set operations (union / intersect / except)', () => {
  const publicStart = leaf(rule('first', 'publicExposed', 'eq', true)); // 20
  const sinkEnd = leaf(rule('last', '_isSink', 'eq', true)); // 12

  it('union', async () => {
    expect((await run(security, { op: 'union', args: [publicStart, sinkEnd] })).body.total).toBe(25);
  });
  it('intersect', async () => {
    expect((await run(security, { op: 'intersect', args: [publicStart, sinkEnd] })).body.total).toBe(7);
  });
  it('except removes the later operands from the first', async () => {
    expect((await run(security, { op: 'except', args: [publicStart, sinkEnd] })).body.total).toBe(13);
    expect((await run(security, { op: 'except', args: [sinkEnd, publicStart] })).body.total).toBe(5);
  });
  it('intersect gives the same routes as the single combined query', async () => {
    const combined = await run(
      security,
      leaf(rule('first', 'publicExposed', 'eq', true), rule('last', '_isSink', 'eq', true)),
    );
    const viaSets = await run(security, { op: 'intersect', args: [publicStart, sinkEnd] });
    expect(names(viaSets)).toEqual(names(combined));
  });
  it('nests operations', async () => {
    const high = leaf(rule('any', 'vulnerabilities.severity', 'eq', 'high'));
    const res = await run(security, { op: 'except', args: [{ op: 'intersect', args: [publicStart, sinkEnd] }, high] });
    expect(names(res)).toEqual(['admin>reports>events', 'api>reports>events', 'web>api>reports>events']);
  });
  it('warns when an operand of intersect/except was truncated, since the result is approximate', async () => {
    const res = await run(security, { op: 'intersect', args: [publicStart, sinkEnd] }, { limit: 5 });
    expect(res.body.warnings.map((w: Json) => w.code)).toContain('APPROXIMATE_SET_OPERATION');
    expect(res.body.truncated).toBe(true);
  });
});

describe('raw Cypher queries (WorkPlan A4.2)', () => {
  it('runs a read-only path query scoped to the graph', async () => {
    const res = await run(
      security,
      raw('MATCH p = (a:Node {graphId: $g, publicExposed: true})-[:CALLS*0..3]->(b:Node {_isSink: true}) RETURN p'),
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(6);
    expect(res.body.routes[0].nodeIds).toHaveLength(4);
  });

  it('a single node is a one-node route', async () => {
    const res = await run(security, raw("MATCH (n:Node {graphId: $g}) WHERE n.kind = 'rds' RETURN n"));
    expect(names(res)).toEqual(['ledger-db']);
    expect(res.body.routes[0]).toMatchObject({ length: 1, edgeIds: [] });
  });

  it('combines with builder queries in a set operation', async () => {
    const res = await run(security, {
      op: 'intersect',
      args: [
        raw('MATCH p = (a:Node {graphId: $g, publicExposed: true})-[:CALLS*0..3]->(b:Node {_isSink: true}) RETURN p'),
        leaf(rule('any', 'vulnerabilities.severity', 'eq', 'high')),
      ],
    });
    expect(names(res)).toEqual(['api>billing>ledger-db', 'api>worker>billing>ledger-db', 'web>api>billing>ledger-db']);
  });

  it('cannot reach other graphs: foreign nodes are dropped from the result', async () => {
    const res = await run(security, raw('MATCH (n:Node) WHERE n.graphId <> $g RETURN n'));
    expect(res.status).toBe(200);
    expect(res.body.routes).toEqual([]);
  });

  it.each([
    ['writes', 'MATCH (n:Node {graphId: $g}) SET n.x = 1 RETURN n', 'RAW_QUERY_NOT_ALLOWED'],
    ['deletes', 'MATCH (n:Node {graphId: $g}) DETACH DELETE n RETURN n', 'RAW_QUERY_NOT_ALLOWED'],
    ['procedure calls', 'CALL db.labels() YIELD label RETURN label', 'RAW_QUERY_NOT_ALLOWED'],
    ['a missing graph scope', 'MATCH (n:Node) RETURN n', 'RAW_QUERY_UNSCOPED'],
    ['several columns', 'MATCH (n:Node {graphId: $g}) RETURN n, n.name', 'RAW_QUERY_SHAPE'],
    ['non-variable returns', 'MATCH (n:Node {graphId: $g}) RETURN n.name', 'RAW_QUERY_SHAPE'],
    ['syntax errors', 'MATCH (n:Node {graphId: $g RETURN n', 'CYPHER_ERROR'],
  ])('rejects %s with 422', async (_label, text, code) => {
    const res = await run(security, raw(text));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ status: 422, code });
  });

  it('did not modify the data (the write attempts above were refused)', async () => {
    expect((await run(security, leaf())).body.total).toBe(30);
  });
});

describe('cycles (WorkPlan A4.4)', () => {
  it('returns only simple routes and marks routes that return to a node of the route', async () => {
    const res = await run(cyclic, leaf());
    expect(res.body.total).toBe(14);
    for (const r of res.body.routes) expect(new Set(r.nodeIds).size).toBe(r.nodeIds.length);
    const closes = Object.fromEntries(
      res.body.routes.filter((r: Json) => r.closesTo).map((r: Json) => [r.nodeIds.join('>'), r.closesTo]),
    );
    expect(closes).toEqual({
      'a>b>c>d': 'b',
      'b>c>d': 'b',
      'c>d>b': 'c',
      'd>b>c': 'd',
      self: 'self',
    });
  });

  it('has no maximal routes: every node has an outgoing edge', async () => {
    expect((await run(cyclic, leaf(), { routeMode: 'maximal' })).body.total).toBe(0);
  });
});

describe('request validation', () => {
  it('422 for malformed queries, with a readable message', async () => {
    for (const body of [
      { query: { op: 'leaf' } },
      { query: { op: 'except', args: [leaf()] } },
      { query: leaf(), limit: 10001 },
      { query: leaf(), maxHops: 101 },
      { query: leaf(rule('middle', 'x', 'eq', 1)) },
      {},
    ]) {
      const res = await stack.query(security, body);
      expect(res.status).toBe(422);
      expect(res.body.error.message).toEqual(expect.any(String));
    }
  });

  it('422 for rules without a value, 400 for a body that is not JSON', async () => {
    expect((await run(security, leaf(rule('first', 'name', 'eq')))).status).toBe(422);
    const res = await stack.api.request<Json>('POST', `/graphs/${security}/routes/query`, { body: '{nope' });
    expect(res.status).toBe(400);
  });

  it('404 for an unknown graph', async () => {
    expect((await run('ffffffffffffffff', leaf())).status).toBe(404);
  });

  it('422 for queries with more than 200 conditions', async () => {
    const rules = Array.from({ length: 201 }, () => rule('any', 'name', 'eq', 'web'));
    const res = await run(security, { op: 'leaf', builder: group('or', ...rules) });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('QUERY_TOO_LARGE');
  });

  it('accepts a heavy query with 70 conditions', async () => {
    const rules = Array.from({ length: 70 }, (_, i) => rule('any', 'name', 'eq', i === 0 ? 'web' : `nothing-${i}`));
    const res = await run(security, { op: 'leaf', builder: group('or', ...rules) });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(9);
  });
});

describe('route queries on the sample file (train-ticket-be.json)', () => {
  const total = async (query: unknown, extra: object = {}) => (await run(sample, query, extra)).body.total;

  it('enumerates 487 routes (440 with edges + 47 single nodes) and 222 maximal ones', async () => {
    expect(await total(leaf(), { limit: 1000 })).toBe(487);
    expect(await total(leaf(), { routeMode: 'maximal' })).toBe(222);
    const res = await run(sample, leaf(), { limit: 1000 });
    expect(res.body.routes[0].length).toBe(6);
    expect(res.body.routes.filter((r: Json) => r.length === 6)).toHaveLength(12);
  });

  it('public entry points: frontend (7 routes) and the isolated gateway-service (1)', async () => {
    const res = await run(sample, leaf(rule('first', 'publicExposed', 'eq', true)));
    expect(res.body.total).toBe(8);
    expect(res.body.routes.filter((r: Json) => r.nodeIds[0] === 'frontend')).toHaveLength(7);
  });

  it('no route leads from a public service to a vulnerable service or a datastore (data finding D5)', async () => {
    expect(await total(leaf(rule('first', 'publicExposed', 'eq', true), rule('last', '_isSink', 'eq', true)))).toBe(0);
    expect(
      await total(leaf(rule('first', 'publicExposed', 'eq', true), rule('any', 'vulnerabilities._count', 'gt', 0))),
    ).toBe(0);
    const empty = await run(
      sample,
      leaf(rule('first', 'publicExposed', 'eq', true), rule('last', '_isSink', 'eq', true)),
    );
    expect(empty.body).toMatchObject({ routes: [], nodes: {}, edges: {}, total: 0, truncated: false });
  });

  it('sinks and vulnerabilities', async () => {
    expect(await total(leaf(rule('last', '_isSink', 'eq', true)))).toBe(47);
    expect(await total(leaf(rule('last', 'name', 'eq', 'prod-postgresdb')))).toBe(42);
    expect(await total(leaf(rule('any', 'vulnerabilities._count', 'gt', 0)))).toBe(123);
    expect(await total(leaf(rule('any', 'vulnerabilities.severity', 'eq', 'high')))).toBe(105);
    expect(await total(leaf(rule('any', 'name', 'eq', 'auth-service')))).toBe(18);
  });

  it('shows the placeholder node of an incomplete edge target', async () => {
    const res = await run(
      sample,
      leaf(rule('last', 'name', 'eq', 'assurance-service'), { type: 'length', min: 2, max: 2 }),
    );
    expect(res.body.total).toBe(2);
    expect(res.body.nodes['assurance-service']).toEqual({
      id: 'assurance-service',
      name: 'assurance-service',
      kind: 'unknown',
      incomplete: true,
    });
  });

  it('answers the incomplete-edge route sets consistently', async () => {
    expect(await total(leaf(), { maxHops: 1, limit: 1000 })).toBe(145);
  });
});
