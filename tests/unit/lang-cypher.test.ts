import type { GraphSchema, PropertyInfo } from '@gd/api-contract';
import { QueryError, type CompileContext, type ConditionTree, type NodeRule } from '@gd/query-core';
import { compileBuilder, estimateMatches, exportRawText, maskLiterals, prepareRaw } from '@gd/lang-cypher';

const prop = (path: string, p: Partial<PropertyInfo> & Pick<PropertyInfo, 'count'>): PropertyInfo => ({
  path,
  type: 'string',
  list: false,
  distinct: 1,
  ...p,
});

// 100 nodes: 2 public, 90 services, 5 rds/sqs sinks; 3 nodes with vulnerabilities
const schema: GraphSchema = {
  graphId: 'g',
  nodeCount: 100,
  edgeCount: 200,
  kinds: [],
  sinkKinds: ['rds', 'sqs'],
  severityScale: {},
  properties: [
    prop('publicExposed', {
      type: 'boolean',
      count: 95,
      values: [
        { value: true, count: 2 },
        { value: false, count: 93 },
      ],
    }),
    prop('kind', {
      count: 100,
      values: [
        { value: 'service', count: 95 },
        { value: 'rds', count: 5 },
      ],
    }),
    prop('_isSink', {
      type: 'boolean',
      count: 100,
      values: [
        { value: true, count: 5 },
        { value: false, count: 95 },
      ],
    }),
    prop('vulnerabilities._count', { type: 'number', count: 3 }),
    prop('vulnerabilities.severity', {
      list: true,
      count: 3,
      values: [
        { value: 'high', count: 1 },
        { value: 'low', count: 2 },
      ],
    }),
    prop('vulnerabilities.metadata.cwe', {
      list: true,
      count: 3,
      values: [{ value: 'cwe-89: sql injection', count: 1 }],
    }),
    prop('name', { count: 100 }),
  ],
};

const ctx = (over: Partial<CompileContext> = {}): CompileContext => ({
  graphId: 'g1',
  maxHops: 50,
  limit: 1000,
  routeMode: 'all',
  schema,
  ...over,
});
const rule = (
  position: NodeRule['position'],
  path: string,
  op: NodeRule['op'],
  value?: NodeRule['value'],
): NodeRule => ({
  type: 'rule',
  position,
  path,
  op,
  ...(value === undefined ? {} : { value }),
});
const and = (...rules: ConditionTree['rules']): ConditionTree => ({ type: 'group', combinator: 'and', rules });
const or = (...rules: ConditionTree['rules']): ConditionTree => ({ type: 'group', combinator: 'or', rules });

describe('compileBuilder: the three primary filters (WorkPlan §3.9)', () => {
  it('"starts in a public service" anchors the start node and keeps the graph scope', () => {
    const q = compileBuilder(and(rule('first', 'publicExposed', 'eq', true)), ctx());
    expect(q.text).toContain('MATCH (a:Node {graphId: $g}) WHERE a.`publicExposed` = $p0');
    expect(q.text).toContain('MATCH p = (a)-[:CALLS*0..50]->(b:Node)');
    expect(q.params).toEqual({ g: 'g1', p0: true });
  });

  it('"ends in a sink" anchors the end node', () => {
    const q = compileBuilder(and(rule('last', '_isSink', 'eq', true)), ctx());
    expect(q.text).toContain('MATCH (b:Node {graphId: $g}) WHERE b.`_isSink` = $p0');
    expect(q.text).toContain('MATCH p = (a:Node)-[:CALLS*0..50]->(b)');
  });

  it('"has a vulnerability" goes through an anchor node and de-duplicates paths', () => {
    const q = compileBuilder(and(rule('any', 'vulnerabilities._count', 'gt', 0)), ctx());
    expect(q.text).toContain('MATCH (v:Node {graphId: $g}) WHERE v.`vulnerabilities._count` > $p0');
    expect(q.text).toContain('MATCH p = (a:Node)-[:CALLS*0..50]->(v)-[:CALLS*0..50]->(b:Node)');
    expect(q.text).toContain('WITH DISTINCT p');
    expect(q.text).toContain('length(p) <= 50');
  });

  it('searches list properties element-wise and normalises the value to lower case', () => {
    const sev = compileBuilder(and(rule('any', 'vulnerabilities.severity', 'eq', ' HIGH ')), ctx());
    expect(sev.text).toContain('$p0 IN v.`vulnerabilities.severity`');
    expect(sev.params.p0).toBe('high');
    const cwe = compileBuilder(and(rule('any', 'vulnerabilities.metadata.cwe', 'contains', 'CWE-89')), ctx());
    expect(cwe.text).toContain('any(x IN coalesce(v.`vulnerabilities.metadata.cwe`, []) WHERE x CONTAINS $p0)');
    expect(cwe.params.p0).toBe('cwe-89');
  });

  it('combines public entry, severity and sink: the most selective rule is the anchor', () => {
    // estimated matches: sink ~5 nodes, public ~2, severity "low" ~2 (a tie goes to first/last over any)
    const q = compileBuilder(
      and(
        rule('last', '_isSink', 'eq', true),
        rule('first', 'publicExposed', 'eq', true),
        rule('any', 'vulnerabilities.severity', 'eq', 'low'),
      ),
      ctx(),
    );
    expect(q.text).toContain('MATCH (a:Node {graphId: $g}) WHERE a.`publicExposed` = $p2');
    expect(q.text).toContain('b.`_isSink` = $p0');
    expect(q.text).toContain('any(n IN nodes(p) WHERE $p1 IN n.`vulnerabilities.severity`)');
  });

  it('anchors the vulnerability when it is the most selective rule (severity "high" matches one node)', () => {
    const q = compileBuilder(
      and(rule('first', 'publicExposed', 'eq', true), rule('any', 'vulnerabilities.severity', 'eq', 'high')),
      ctx(),
    );
    expect(q.text).toContain('MATCH (v:Node {graphId: $g}) WHERE $p1 IN v.`vulnerabilities.severity`');
    expect(q.text).toContain('a.`publicExposed` = $p0');
  });
});

describe('compileBuilder: structure, limits and modes', () => {
  it('always enforces the hop limit, simple paths, ordering and LIMIT n+1 (truncation detection)', () => {
    const q = compileBuilder(and(), ctx({ maxHops: 7, limit: 25 }));
    expect(q.text).toContain('[:CALLS*0..7]');
    expect(q.text).toContain('all(x IN nodes(p) WHERE single(y IN nodes(p) WHERE y = x))');
    expect(q.text).toContain('ORDER BY length(p) DESC, [x IN nodes(p) | x.id]');
    expect(q.text).toMatch(/LIMIT 26$/);
    expect(q.text).toContain('RETURN p AS r');
  });

  it('does not anchor an OR root, and wraps the whole predicate', () => {
    const q = compileBuilder(or(rule('first', 'kind', 'eq', 'rds'), rule('last', 'kind', 'eq', 'sqs')), ctx());
    expect(q.text).toContain('MATCH p = (a:Node {graphId: $g})-[:CALLS*0..50]->(b:Node)');
    expect(q.text).toContain('(a.`kind` = $p0 OR b.`kind` = $p1)');
  });

  it('does not anchor on a broad "any" rule (more than half of the nodes)', () => {
    const q = compileBuilder(and(rule('any', 'kind', 'eq', 'service')), ctx());
    expect(q.text).not.toContain('(v:Node');
    expect(q.text).toContain('any(n IN nodes(p) WHERE n.`kind` = $p0)');
  });

  it('prefers first/last anchors over an equally selective any anchor', () => {
    const q = compileBuilder(
      and(rule('any', 'publicExposed', 'eq', true), rule('first', 'publicExposed', 'eq', true)),
      ctx(),
    );
    expect(q.text).toContain('MATCH (a:Node {graphId: $g}) WHERE a.`publicExposed`');
  });

  it('translates all/none positions and route length (node count)', () => {
    const q = compileBuilder(
      and(rule('all', 'kind', 'eq', 'service'), rule('none', '_isSink', 'eq', true), {
        type: 'length',
        min: 2,
        max: 4,
      }),
      ctx({ schema: undefined }),
    );
    expect(q.text).toContain('all(n IN nodes(p) WHERE n.`kind` = $p0)');
    expect(q.text).toContain('none(n IN nodes(p) WHERE n.`_isSink` = $p1)');
    expect(q.text).toContain('(length(p) + 1 >= 2 AND length(p) + 1 <= 4)');
  });

  it('restricts to maximal routes (source to sink) on request', () => {
    const q = compileBuilder(and(), ctx({ routeMode: 'maximal' }));
    expect(q.text).toContain('NOT EXISTS { MATCH (:Node)-[:CALLS]->(a) }');
    expect(q.text).toContain('NOT EXISTS { MATCH (b)-[:CALLS]->(:Node) }');
  });

  it('supports every operator on scalar properties', () => {
    const text = (op: NodeRule['op'], value?: NodeRule['value']) =>
      compileBuilder(or(rule('first', 'name', op, value)), ctx()).text;
    expect(text('neq', 'x')).toContain('(a.`name` IS NULL OR a.`name` <> $p0)');
    expect(text('in', ['a', 'b'])).toContain('a.`name` IN $p0');
    expect(text('startsWith', 'ab')).toContain('a.`name` STARTS WITH $p0');
    expect(text('gte', 3)).toContain('a.`name` >= $p0');
    expect(text('lt', 3)).toContain('a.`name` < $p0');
    expect(text('exists')).toContain('a.`name` IS NOT NULL');
    expect(text('notExists')).toContain('a.`name` IS NULL');
  });

  it('never interpolates user values or property names into the text unescaped', () => {
    const q = compileBuilder(and(rule('first', 'we`ird', 'eq', "x' OR 1=1 //")), ctx());
    expect(q.text).toContain('a.`we``ird` = $p0');
    expect(q.text).not.toContain('OR 1=1');
    expect(q.params.p0).toBe("x' or 1=1 //");
  });

  it('rejects invalid rules', () => {
    expect(() => compileBuilder(and(rule('first', 'name', 'eq')), ctx())).toThrow(QueryError);
    expect(() => compileBuilder(and(rule('first', 'name', 'eq', ['a'])), ctx())).toThrow(QueryError);
    expect(() => compileBuilder(and({ type: 'length', min: 0 }), ctx())).toThrow(QueryError);
    expect(() => compileBuilder(and(), ctx({ maxHops: 0 }))).toThrow(QueryError);
  });
});

describe('estimateMatches', () => {
  it('uses observed value counts', () => {
    expect(estimateMatches(rule('first', 'publicExposed', 'eq', true), schema)).toBe(2);
    expect(estimateMatches(rule('first', 'kind', 'in', ['rds', 'sqs']), schema)).toBe(5);
    expect(estimateMatches(rule('first', 'kind', 'neq', 'service'), schema)).toBe(5);
    expect(estimateMatches(rule('first', 'vulnerabilities._count', 'exists'), schema)).toBe(3);
    expect(estimateMatches(rule('first', 'vulnerabilities._count', 'notExists'), schema)).toBe(97);
  });
  it('knows that a property nobody has matches nothing', () => {
    expect(estimateMatches(rule('first', 'nope', 'eq', 1), schema)).toBe(0);
  });
});

describe('prepareRaw: validation and wrapping (WorkPlan A4.2)', () => {
  const ok = (text: string) => prepareRaw(text, ctx({ limit: 10 }));
  const fails = (text: string, code: string) => {
    try {
      prepareRaw(text, ctx());
    } catch (e) {
      expect(e).toBeInstanceOf(QueryError);
      expect((e as QueryError).code).toBe(code);
      return;
    }
    throw new Error(`expected "${text}" to be rejected`);
  };

  it('wraps a path query, applying the route limit and passing the graph id', () => {
    const q = ok('MATCH p = (a:Node {graphId: $g})-[:CALLS*1..3]->(b) WHERE a.kind = "rds" RETURN p;');
    expect(q.kind).toBe('raw');
    expect(q.text.startsWith('CALL {\nMATCH p = (a:Node {graphId: $g})')).toBe(true);
    expect(q.text).toMatch(/RETURN p\n}\nRETURN p AS r\nLIMIT 11$/);
    expect(q.params).toEqual({ g: 'g1', maxHops: 50 });
  });

  it('accepts a single node, an alias, DISTINCT and its own ORDER BY / LIMIT', () => {
    expect(ok('MATCH (n:Node {graphId: $g}) RETURN n').text).toContain('RETURN n AS r');
    expect(
      ok('MATCH p=(n:Node {graphId: $g})-[:CALLS]->() RETURN DISTINCT p AS route ORDER BY length(p) LIMIT 5').text,
    ).toContain('RETURN route AS r');
  });

  it('is not fooled by keywords inside strings, comments or property names', () => {
    expect(() => ok("MATCH (n:Node {graphId: $g}) WHERE n.note = 'please DELETE me; SET x' RETURN n")).not.toThrow();
    expect(() => ok('MATCH (n:Node {graphId: $g}) // CREATE\nWHERE n.set = 1 RETURN n')).not.toThrow();
    expect(maskLiterals("a 'DELETE' b")).toBe("a '______' b");
  });

  it('rejects write and admin clauses and procedure calls', () => {
    for (const bad of [
      'MATCH (n:Node {graphId: $g}) DETACH DELETE n RETURN n',
      'MATCH (n:Node {graphId: $g}) SET n.x = 1 RETURN n',
      'CREATE (n:Node {graphId: $g}) RETURN n',
      'MERGE (n:Node {graphId: $g}) RETURN n',
      'MATCH (n:Node {graphId: $g}) REMOVE n.x RETURN n',
      'CALL db.labels() YIELD label RETURN label',
      'LOAD CSV FROM "x" AS r MATCH (n {graphId: $g}) RETURN n',
      'MATCH (n:Node {graphId: $g}) RETURN n UNION MATCH (m:Node {graphId: $g}) RETURN m',
    ]) {
      fails(bad, 'RAW_QUERY_NOT_ALLOWED');
    }
  });

  it('rejects several statements', () => {
    fails('MATCH (n:Node {graphId: $g}) RETURN n; MATCH (m) RETURN m', 'INVALID_QUERY');
  });

  it('requires the graph scope $g', () => {
    fails('MATCH (n:Node) RETURN n', 'RAW_QUERY_UNSCOPED');
    fails("MATCH (n:Node {graphId: 'other'}) RETURN n", 'RAW_QUERY_UNSCOPED');
  });

  it('requires one RETURN with one plain variable: a path or a node', () => {
    fails('MATCH (n:Node {graphId: $g}) RETURN n, n.name', 'RAW_QUERY_SHAPE');
    fails('MATCH (n:Node {graphId: $g}) RETURN n.name', 'RAW_QUERY_SHAPE');
    fails('MATCH (n:Node {graphId: $g}) RETURN *', 'RAW_QUERY_SHAPE');
    fails('MATCH (n:Node {graphId: $g}) RETURN count(n)', 'RAW_QUERY_SHAPE');
    fails('MATCH (n:Node {graphId: $g}) WHERE n.x = 1', 'RAW_QUERY_SHAPE');
    fails('   ', 'INVALID_QUERY');
  });

  it('accepts the text exported from a builder query (builder -> raw round trip)', () => {
    const tree = and(
      rule('first', 'publicExposed', 'eq', true),
      rule('any', 'vulnerabilities.severity', 'in', ['High', 'critical']),
    );
    const text = exportRawText(tree, ctx());
    expect(text).not.toMatch(/\$p\d/);
    expect(text).toContain("['high', 'critical']");
    expect(() => prepareRaw(text, ctx())).not.toThrow();
  });
});
