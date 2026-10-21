import {
  DEFAULT_CONFIG,
  detectCycles,
  discoverSchema,
  finalizeGraph,
  flattenNode,
  parseGraph,
  trimStrings,
  type ParseResult,
} from '@gd/graph-core';
import { fixture, sampleGraph } from '../setup/fixtures';

function parseOk(input: unknown): Extract<ParseResult, { ok: true }> {
  const res = parseGraph(input);
  if (!res.ok) throw new Error(`expected a valid graph: ${JSON.stringify(res.errors)}`);
  return res;
}

describe('parseGraph: the sample file', () => {
  const res = parseOk(sampleGraph());

  it('keeps all 46 nodes and adds one placeholder for the undefined "assurance-service"', () => {
    expect(res.graph.nodes).toHaveLength(47);
    const placeholders = res.graph.nodes.filter((n) => n.incomplete);
    expect(placeholders.map((n) => n.id)).toEqual(['assurance-service']);
  });

  it('normalises the grouped edges into 98 individual edges, including the string-valued "to"', () => {
    expect(res.graph.edges).toHaveLength(98);
    expect(res.graph.edges.find((e) => e.id === 'consign-service->consign-price-service')).toBeDefined();
  });

  it('reports the missing node as a derivable 422 issue and a warning, and finds no cycle', () => {
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0]).toMatchObject({ status: 422, code: 'MISSING_NODE', ref: 'assurance-service' });
    expect(res.issues[0].message).toContain('2 edge(s)');
    expect(res.warnings.map((w) => w.code)).toEqual(['MISSING_NODE']);
  });
});

describe('parseGraph: invalid input (HTTP 401)', () => {
  const codes = (input: unknown) => {
    const res = parseGraph(input);
    return res.ok ? [] : res.errors.map((e) => e.code);
  };

  it('rejects malformed JSON text', () => {
    expect(codes('{"nodes": [')).toEqual(['INVALID_JSON']);
  });
  it('rejects a missing or non-array "nodes"', () => {
    expect(codes({})).toEqual(['INVALID_FORMAT']);
    expect(codes({ nodes: 'x' })).toEqual(['INVALID_FORMAT']);
  });
  it('rejects nodes without a name, and empty names', () => {
    expect(codes({ nodes: [{ kind: 'service' }] })).toEqual(['INVALID_FORMAT']);
    expect(codes({ nodes: [{ name: '   ' }] })).toEqual(['INVALID_FORMAT']);
  });
  it('rejects edges without "from" or with a "to" that is neither string nor array of strings', () => {
    expect(codes({ nodes: [{ name: 'a' }], edges: [{ to: 'a' }] })).toEqual(['INVALID_FORMAT']);
    expect(codes({ nodes: [{ name: 'a' }], edges: [{ from: 'a', to: 5 }] })).toEqual(['INVALID_FORMAT']);
    expect(codes({ nodes: [{ name: 'a' }], edges: [{ from: 'a', to: ['b', 7] }] })).toEqual(['INVALID_FORMAT']);
  });
  it('treats duplicate node names as errors, case-insensitively', () => {
    const res = parseGraph({ nodes: [{ name: 'A' }, { name: ' a ' }] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toMatchObject({ code: 'DUPLICATE_NODE_NAME', path: 'nodes[name=a]' });
  });
});

describe('parseGraph: normalisation', () => {
  it('trims and lower-cases names for ids but keeps the original casing in the raw node', () => {
    const res = parseOk({
      nodes: [{ name: '  Web  ', kind: 'Service', note: 'Line\n' }],
      edges: [{ from: 'WEB', to: ' web ' }],
    });
    const node = res.graph.nodes[0];
    expect(node.id).toBe('web');
    expect(node.raw).toEqual({ name: 'Web', kind: 'Service', note: 'Line' });
    expect(res.graph.edges[0]).toMatchObject({ id: 'web->web', from: 'web', to: 'web' });
  });

  it('drops duplicate edges with a warning', () => {
    const res = parseOk({
      nodes: [{ name: 'a' }, { name: 'b' }],
      edges: [
        { from: 'a', to: ['b', 'b'] },
        { from: 'a', to: 'b' },
      ],
    });
    expect(res.graph.edges).toHaveLength(1);
    expect(res.warnings.filter((w) => w.code === 'DUPLICATE_EDGE')).toHaveLength(2);
  });

  it('keeps extra edge properties on every expanded edge', () => {
    const res = parseOk({
      nodes: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
      edges: [{ from: 'a', to: ['b', 'c'], protocol: 'HTTP ' }],
    });
    expect(res.graph.edges.map((e) => e.extra)).toEqual([{ protocol: 'HTTP' }, { protocol: 'HTTP' }]);
  });

  it('creates placeholders for undefined edge sources too', () => {
    const res = parseOk({ nodes: [{ name: 'b' }], edges: [{ from: 'Ghost', to: 'b' }] });
    expect(res.graph.nodes.find((n) => n.id === 'ghost')).toMatchObject({ incomplete: true, name: 'Ghost' });
  });

  it('accepts a graph without edges', () => {
    expect(parseOk({ nodes: [{ name: 'solo' }] }).graph.edges).toEqual([]);
  });

  it('is deterministic: nodes and edges are sorted by id', () => {
    const res = parseOk({ nodes: [{ name: 'z' }, { name: 'a' }], edges: [{ from: 'z', to: 'a' }] });
    expect(res.graph.nodes.map((n) => n.id)).toEqual(['a', 'z']);
  });
});

describe('cycle detection', () => {
  it('finds a multi-node cycle and a self-loop in the cyclic fixture', () => {
    const res = parseOk(fixture('cyclic.json'));
    const cycles = res.warnings.filter((w) => w.code === 'CYCLE');
    expect(cycles).toHaveLength(2);
    expect(cycles.map((c) => c.message).join('\n')).toContain('b, c, d');
    expect(cycles.map((c) => c.ref).sort()).toEqual(['b', 'self']);
  });

  it('reports nothing for an acyclic graph', () => {
    expect(
      detectCycles(
        ['a', 'b', 'c'],
        [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'c' },
        ],
      ),
    ).toEqual([]);
  });

  it('handles long chains without recursion limits', () => {
    const ids = Array.from({ length: 20000 }, (_, i) => `n${i}`);
    const edges = ids.slice(1).map((to, i) => ({ from: ids[i], to }));
    expect(detectCycles(ids, edges)).toEqual([]);
  });
});

describe('flattenNode (WorkPlan §3.1)', () => {
  const flat = flattenNode(
    trimStrings({
      name: 'Billing ',
      publicExposed: false,
      tags: ['A', 'b'],
      metadata: { cloud: 'AWS', nested: { level: 2 } },
      vulnerabilities: [
        { severity: 'HIGH', file: 'a.java', metadata: { cwe: 'CWE-89: SQL' } },
        { severity: 'low', file: 'b.java', metadata: { cwe: 'CWE-22: Path' } },
      ],
      empty: null,
    }),
  );

  it('keeps scalars and lower-cases strings', () => {
    expect(flat.name).toBe('billing');
    expect(flat.publicExposed).toBe(false);
  });
  it('turns arrays of scalars into lists and nested objects into dot-path keys', () => {
    expect(flat.tags).toEqual(['a', 'b']);
    expect(flat['metadata.cloud']).toBe('aws');
    expect(flat['metadata.nested.level']).toBe(2);
  });
  it('turns arrays of objects into parallel lists plus a count, following nested objects', () => {
    expect(flat['vulnerabilities._count']).toBe(2);
    expect(flat['vulnerabilities.severity']).toEqual(['high', 'low']);
    expect(flat['vulnerabilities.metadata.cwe']).toEqual(['cwe-89: sql', 'cwe-22: path']);
  });
  it('drops null values', () => {
    expect('empty' in flat).toBe(false);
  });
});

describe('finalizeGraph: derived properties (WorkPlan §3.1.1)', () => {
  const { graph, warnings } = finalizeGraph(parseOk(fixture('security.json')).graph);
  const byId = (id: string) => graph.nodes.find((n) => n.id === id)!;

  it('marks sinks by kind: rds and sqs are sinks, services are not', () => {
    expect(byId('ledger-db').props._isSink).toBe(true);
    expect(byId('events').props._isSink).toBe(true);
    expect(byId('billing').props._isSink).toBe(false);
  });
  it('marks terminal nodes (no outgoing edges) separately from sinks', () => {
    expect(byId('lonely').props._isTerminal).toBe(true);
    expect(byId('lonely').props._isSink).toBe(false);
    expect(byId('api').props._isTerminal).toBe(false);
  });
  it('computes in+out degree', () => {
    expect(byId('api').props._degree).toBe(4); // in: Web; out: billing, reports, worker
    expect(byId('billing').props._degree).toBe(3); // in: api, worker; out: ledger-db
    expect(byId('lonely').props._degree).toBe(0);
  });
  it('ranks the highest severity of a node (case-insensitive) and leaves clean nodes without a rank', () => {
    expect(byId('billing').props['vulnerabilities._maxSeverityRank']).toBe(3);
    expect(byId('reports').props['vulnerabilities._maxSeverityRank']).toBe(2);
    expect('vulnerabilities._maxSeverityRank' in byId('worker').props).toBe(false);
  });
  it('lower-cases kinds for querying while keeping the original in raw', () => {
    expect(byId('web').props.kind).toBe('service');
    expect(byId('web').raw.kind).toBe('Service');
  });
  it('gives nodes without a kind the kind "unknown"', () => {
    const g = finalizeGraph(parseOk({ nodes: [{ name: 'x' }] }).graph).graph;
    expect(g.nodes[0].kind).toBe('unknown');
  });
  it('never treats placeholders as sinks and reports unknown severities', () => {
    const res = finalizeGraph(
      parseOk({
        nodes: [{ name: 'a', vulnerabilities: [{ severity: 'spicy' }] }],
        edges: [{ from: 'a', to: 'rds-ghost' }],
      }).graph,
      { ...DEFAULT_CONFIG, sinkKinds: ['unknown', 'rds'] },
    );
    expect(res.graph.nodes.find((n) => n.id === 'rds-ghost')!.props._isSink).toBe(false);
    expect(res.warnings).toEqual([expect.objectContaining({ code: 'UNKNOWN_SEVERITY', ref: 'spicy' })]);
    expect('vulnerabilities._maxSeverityRank' in res.graph.nodes[0].props).toBe(false);
  });
  it('produces no warnings for the security fixture', () => {
    expect(warnings).toEqual([]);
  });
});

describe('discoverSchema', () => {
  const { graph } = finalizeGraph(parseOk(sampleGraph()).graph);
  const schema = discoverSchema('g1', graph.nodes, graph.edges.length, DEFAULT_CONFIG);
  const prop = (path: string) => schema.properties.find((p) => p.path === path)!;

  it('counts nodes, edges and kinds', () => {
    expect(schema).toMatchObject({ nodeCount: 47, edgeCount: 98 });
    expect(schema.kinds.map((k) => [k.kind, k.count])).toEqual([
      ['rds', 1],
      ['service', 44],
      ['sqs', 1],
      ['unknown', 1],
    ]);
  });
  it('lists observed values with counts', () => {
    expect(prop('kind').values).toEqual([
      { value: 'service', count: 44 },
      { value: 'rds', count: 1 },
      { value: 'sqs', count: 1 },
      { value: 'unknown', count: 1 },
    ]);
    expect(prop('publicExposed')).toMatchObject({ type: 'boolean', count: 44 });
  });
  it('describes list properties built from the vulnerabilities', () => {
    expect(prop('vulnerabilities.severity')).toMatchObject({ list: true, type: 'string', count: 2 });
    expect(prop('vulnerabilities.severity').values).toEqual([
      { value: 'medium', count: 2 },
      { value: 'high', count: 1 },
    ]);
    expect(prop('vulnerabilities._count')).toMatchObject({ type: 'number', min: 1, max: 2 });
  });
  it('excludes internal properties', () => {
    expect(schema.properties.some((p) => ['id', 'graphId', '_raw'].includes(p.path))).toBe(false);
    expect(schema.properties.some((p) => p.path === '_isSink')).toBe(true);
  });
});
