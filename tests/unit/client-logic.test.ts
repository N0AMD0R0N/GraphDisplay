import { DEFAULT_CONFIG, discoverSchema, finalizeGraph, parseGraph } from '@gd/graph-core';
import type { SetTree } from '@gd/query-core';
import { upstreamOf, upstreamOfEdge } from '../../apps/client/src/lib/highlight';
import type { FlowEdge } from '../../apps/client/src/types';
import {
  maxSeverityRank,
  NO_VULNERABILITY_COLOR,
  routeSeverity,
  severityColor,
  severityPosition,
  vulnerabilityColor,
} from '../../apps/client/src/lib/severity';
import { DEFAULT_COMBINE, blocksToTree, newBlock, treeToBlocks } from '../../apps/client/src/lib/blocks';
import { buildSearch, parseUrlState, queryString } from '../../apps/client/src/lib/urlState';
import { fixture } from '../setup/fixtures';

const parsed = parseGraph(fixture('security.json'));
if (!parsed.ok) throw new Error('fixture');
const { graph } = finalizeGraph(parsed.graph);
const schema = discoverSchema('g1', graph.nodes, graph.edges.length, DEFAULT_CONFIG);
const SCALE = DEFAULT_CONFIG.severityScale;

describe('vulnerability border colours', () => {
  it('runs from light orange (lowest) to pinkish red (highest)', () => {
    expect(severityColor(0)).toBe('#ffc078');
    expect(severityColor(1)).toBe('#e64980');
    expect(severityColor(-3)).toBe(severityColor(0));
    expect(severityColor(7)).toBe(severityColor(1));
  });

  it('gets steadily redder: the green channel falls and the blue channel rises with severity', () => {
    const channels = [0, 0.25, 0.5, 0.75, 1].map((t) => {
      const hex = severityColor(t);
      return { g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
    });
    for (let i = 1; i < channels.length; i++) {
      expect(channels[i].g).toBeLessThan(channels[i - 1].g);
      expect(channels[i].b).toBeGreaterThan(channels[i - 1].b);
    }
  });

  it('positions a rank on the severity scale', () => {
    expect(['info', 'low', 'medium', 'high', 'critical'].map((s) => severityPosition(SCALE[s], SCALE))).toEqual([
      0, 0.25, 0.5, 0.75, 1,
    ]);
    expect(severityPosition(2, {})).toBe(1);
  });

  it('marks a node by its most severe vulnerability, whatever the casing', () => {
    const billing = { vulnerabilities: [{ severity: 'low' }, { severity: 'HIGH' }] };
    expect(maxSeverityRank(billing, SCALE)).toBe(3);
    expect(vulnerabilityColor(billing, SCALE)).toBe(severityColor(0.75));
    expect(vulnerabilityColor({ vulnerabilities: [{ severity: 'critical' }] }, SCALE)).toBe('#e64980');
  });

  it('does not mark nodes without vulnerabilities, and marks unknown severities at the lowest end', () => {
    expect(vulnerabilityColor({ name: 'clean' }, SCALE)).toBeUndefined();
    expect(vulnerabilityColor({ vulnerabilities: [] }, SCALE)).toBeUndefined();
    expect(vulnerabilityColor({ vulnerabilities: [{ severity: 'spicy' }] }, SCALE)).toBe(severityColor(0));
  });
});

describe('route markers in the route list (highest vulnerability severity)', () => {
  const nodes = {
    web: { name: 'Web' },
    api: { name: 'api' },
    billing: { vulnerabilities: [{ severity: 'low' }, { severity: 'HIGH' }] },
    reports: { vulnerabilities: [{ severity: 'medium' }] },
    core: { vulnerabilities: [{ severity: 'critical' }] },
  };

  it('is black when no node of the route has a vulnerability', () => {
    expect(NO_VULNERABILITY_COLOR).toBe('#000000');
    expect(routeSeverity(['web', 'api'], nodes, SCALE)).toEqual({ rank: null, color: '#000000' });
  });

  it('uses the colour of the most severe vulnerable node, like the node borders do', () => {
    expect(routeSeverity(['web', 'api', 'reports'], nodes, SCALE)).toEqual({ rank: 2, color: severityColor(0.5) });
    expect(routeSeverity(['web', 'billing'], nodes, SCALE)).toEqual({ rank: 3, color: severityColor(0.75) });
    expect(routeSeverity(['web', 'billing'], nodes, SCALE).color).toBe(vulnerabilityColor(nodes.billing, SCALE));
  });

  it('takes the highest severity when a route passes several vulnerable nodes', () => {
    expect(routeSeverity(['reports', 'billing', 'core'], nodes, SCALE)).toEqual({ rank: 4, color: '#e64980' });
    expect(routeSeverity(['reports', 'billing'], nodes, SCALE).rank).toBe(3);
  });

  it('ignores ids that are not in the result and works without a scale', () => {
    expect(routeSeverity(['ghost', 'api'], nodes, SCALE).rank).toBeNull();
    expect(routeSeverity([], nodes, SCALE).color).toBe('#000000');
    expect(routeSeverity(['billing'], nodes, {}).rank).toBe(0); // vulnerable, but the scale is unknown: lowest position
  });
});

describe('routes up to a node or an edge (highlight in the whole graph)', () => {
  const e = (from: string, to: string): FlowEdge => ({ id: `${from}->${to}`, from, to });
  //   a -> b -> d -> e -> f        x -> c -> d        a -> c
  const edges = [e('a', 'b'), e('b', 'd'), e('a', 'c'), e('c', 'd'), e('x', 'c'), e('d', 'e'), e('e', 'f')];

  it('highlights every node and edge on a route that ends at the clicked node', () => {
    const h = upstreamOf('d', edges);
    expect([...h.nodes].sort()).toEqual(['a', 'b', 'c', 'd', 'x']);
    expect([...h.edges].sort()).toEqual(['a->b', 'a->c', 'b->d', 'c->d', 'x->c']);
  });

  it('leaves the part after the node alone', () => {
    const h = upstreamOf('d', edges);
    expect(h.nodes.has('e') || h.nodes.has('f')).toBe(false);
    expect(h.edges.has('d->e')).toBe(false);
  });

  it('a source node has no routes up to it: only itself', () => {
    expect(upstreamOf('x', edges)).toEqual({ nodes: new Set(['x']), edges: new Set() });
  });

  describe('a clicked edge: only the routes that end at the node it points to AND pass through that edge', () => {
    const lit = (edge: FlowEdge) => {
      const h = upstreamOfEdge(edge, edges);
      return { nodes: [...h.nodes].sort(), edges: [...h.edges].sort() };
    };

    it('leaves out the routes that reach the end node through its other incoming edges', () => {
      // d is reached through b->d and c->d: clicking c->d must not light up b (only reachable via b->d)
      expect(lit(e('c', 'd'))).toEqual({ nodes: ['a', 'c', 'd', 'x'], edges: ['a->c', 'c->d', 'x->c'] });
      expect(lit(e('b', 'd'))).toEqual({ nodes: ['a', 'b', 'd'], edges: ['a->b', 'b->d'] });
    });

    it('stops at the end node: nothing after it is highlighted', () => {
      expect(lit(e('d', 'e'))).toEqual({
        nodes: ['a', 'b', 'c', 'd', 'e', 'x'],
        edges: ['a->b', 'a->c', 'b->d', 'c->d', 'd->e', 'x->c'],
      });
    });

    it('an edge out of a source node is just the edge', () => {
      expect(lit(e('x', 'c'))).toEqual({ nodes: ['c', 'x'], edges: ['x->c'] });
    });

    it('never lets a route visit the end node twice, even in a cycle', () => {
      const cyclic = [e('a', 'b'), e('b', 'c'), e('c', 'a'), e('c', 'z')];
      const h = upstreamOfEdge(e('c', 'a'), cyclic);
      // routes ending at a through c->a: c>a and b>c>a (a>b>c>a would repeat a)
      expect([...h.nodes].sort()).toEqual(['a', 'b', 'c']);
      expect([...h.edges].sort()).toEqual(['b->c', 'c->a']);
    });
  });

  it('terminates on cycles', () => {
    const cyclic = [e('a', 'b'), e('b', 'c'), e('c', 'a'), e('c', 'z')];
    expect([...upstreamOf('c', cyclic).nodes].sort()).toEqual(['a', 'b', 'c']);
    expect([...upstreamOf('z', cyclic).nodes].sort()).toEqual(['a', 'b', 'c', 'z']);
  });

  it('handles an unknown node and an empty graph', () => {
    expect(upstreamOf('nope', edges)).toEqual({ nodes: new Set(['nope']), edges: new Set() });
    expect(upstreamOf('a', [])).toEqual({ nodes: new Set(['a']), edges: new Set() });
  });
});

describe('the query in the address bar', () => {
  const query: SetTree = {
    op: 'leaf',
    builder: {
      type: 'group',
      combinator: 'and',
      rules: [{ type: 'rule', position: 'first', path: 'publicExposed', op: 'eq', value: true }],
    },
  };

  it('is written as a readable URL query and read back unchanged', () => {
    const search = buildSearch({
      graph: 'abc123',
      q: query,
      mode: 'maximal',
      hops: 10,
      limit: 500,
      run: true,
      route: 3,
      view: 'graph',
    });
    expect(search.startsWith('?graph=abc123&q=')).toBe(true);
    expect(decodeURIComponent(search)).toContain('"position":"first"');
    expect(parseUrlState(search)).toEqual({
      graph: 'abc123',
      q: query,
      mode: 'maximal',
      hops: 10,
      limit: 500,
      run: true,
      route: 3,
      view: 'graph',
    });
  });

  it('leaves out defaults and the result state when no result is shown', () => {
    expect(buildSearch({})).toBe('');
    expect(buildSearch({ graph: 'g', mode: 'all' })).toBe('?graph=g');
    expect(buildSearch({ graph: 'g', route: 4, view: 'route' })).toBe('?graph=g'); // route/view only mean something with run=1
  });

  it('survives special characters in raw Cypher', () => {
    const raw: SetTree = { op: 'leaf', text: "MATCH (n:Node {graphId: $g}) WHERE n.name = 'a&b=c#d' RETURN n" };
    expect(parseUrlState(buildSearch({ q: raw })).q).toEqual(raw);
  });

  it('ignores a query that is not valid, instead of breaking the page', () => {
    expect(parseUrlState('?graph=g&q=%7Bnot-json').q).toBeUndefined();
    expect(parseUrlState('?q=' + encodeURIComponent('{"op":"leaf"}')).q).toBeUndefined(); // neither builder nor text
    expect(parseUrlState('?q=' + encodeURIComponent('{"op":"leaf","text":"x","builder":{}}')).q).toBeUndefined();
    expect(parseUrlState('?hops=abc&limit=-3&route=x&mode=weird&view=weird')).toEqual({});
  });

  it('builds the query string of the API request (GET /graphs/:id/routes/query)', () => {
    const qs = new URLSearchParams(queryString({ query, limit: 50, maxHops: 3, routeMode: 'maximal' }));
    expect(JSON.parse(qs.get('q')!)).toEqual(query);
    expect([qs.get('limit'), qs.get('maxHops'), qs.get('routeMode')]).toEqual(['50', '3', 'maximal']);
    expect([...new URLSearchParams(queryString({ query })).keys()]).toEqual(['q']);
  });
});

describe('editor blocks <-> query', () => {
  const TEXT = 'MATCH p = (a:Node {graphId: $g}) RETURN p';

  it('queries are combined by intersection unless another operation is chosen', () => {
    expect(DEFAULT_COMBINE).toBe('intersect');
    expect(newBlock(TEXT).op).toBe('intersect');
    const { query } = blocksToTree([newBlock(TEXT), newBlock(TEXT)], schema)!;
    expect(query).toMatchObject({ op: 'intersect', args: [{ op: 'leaf' }, { op: 'leaf' }] });
  });

  it('an empty editor is the query for all routes', () => {
    const result = blocksToTree([newBlock(TEXT)], schema)!;
    expect(result.errors).toEqual([]);
    expect(result.query).toEqual({ op: 'leaf', builder: { type: 'group', combinator: 'and', rules: [] } });
  });

  it('combines the queries from the top: ((A union B) except C)', () => {
    const a = newBlock(TEXT);
    const b = { ...newBlock(TEXT, 'union'), mode: 'raw' as const, text: 'MATCH (n:Node {graphId: $g}) RETURN n' };
    const c = { ...newBlock(TEXT, 'except'), mode: 'raw' as const, text: 'MATCH (m:Node {graphId: $g}) RETURN m' };
    const { query } = blocksToTree([a, b, c], schema)!;
    expect(query).toMatchObject({
      op: 'except',
      args: [{ op: 'union', args: [{ builder: {} }, { text: b.text }] }, { text: c.text }],
    });
  });

  it('reports unfinished parts for running, but leaves them out for the address bar', () => {
    const raw = { ...newBlock(TEXT), mode: 'raw' as const, text: '  ' };
    expect(blocksToTree([raw], schema)!.errors).toEqual(['Query A: the Cypher text is empty']);
    expect(blocksToTree([raw], schema, true)).toBeNull();
    const withEmptyRule = newBlock(TEXT);
    withEmptyRule.rqb = { ...withEmptyRule.rqb, rules: [{ field: 'first|kind', operator: 'eq', value: '' }] };
    expect(blocksToTree([withEmptyRule], schema)!.errors).toEqual(['"kind" needs a value']);
    expect(blocksToTree([withEmptyRule], schema, true)!.errors).toEqual([]);
  });

  it('turns a query from the URL back into editor blocks (round trip)', () => {
    const a = newBlock(TEXT);
    a.rqb = {
      ...a.rqb,
      rules: [
        { field: 'first|publicExposed', operator: 'eq', value: 'true' },
        { field: 'last|kind', operator: 'in', value: 'rds, sqs' },
      ],
    };
    const b = { ...newBlock(TEXT, 'intersect'), mode: 'raw' as const, text: 'MATCH (n:Node {graphId: $g}) RETURN n' };
    const original = blocksToTree([a, b], schema)!.query;
    const blocks = treeToBlocks(original, TEXT)!;
    expect(blocks.map((x) => [x.mode, x.op])).toEqual([
      ['builder', 'intersect'],
      ['raw', 'intersect'],
    ]);
    expect(blocks[1].text).toBe(b.text);
    expect(blocksToTree(blocks, schema)!.query).toEqual(original); // the same query, rule values included
  });

  it('cannot show queries that are nested on the right (only possible through the API)', () => {
    const leaf = (text: string): SetTree => ({ op: 'leaf', text });
    expect(
      treeToBlocks({ op: 'union', args: [leaf('a'), { op: 'union', args: [leaf('b'), leaf('c')] }] }, TEXT),
    ).toBeNull();
    expect(treeToBlocks({ op: 'union', args: [leaf('a'), leaf('b'), leaf('c')] }, TEXT)!.map((b) => b.op)).toEqual([
      'intersect', // the first query has no operator of its own
      'union',
      'union',
    ]);
  });
});
