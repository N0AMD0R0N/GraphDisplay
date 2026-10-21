import {
  QueryError,
  combineRows,
  compareRoutes,
  countConditions,
  hashString,
  parseQueryRequest,
  routeKey,
  sortRows,
  toRoute,
  type RouteRow,
} from '@gd/query-core';

const row = (...ids: string[]): RouteRow => ({ nodeIds: ids });
const keys = (rows: RouteRow[]) => rows.map((r) => routeKey(r.nodeIds)).sort();

describe('combineRows (set operations on route keys)', () => {
  const a = [row('x'), row('x', 'y'), row('x', 'y', 'z')];
  const b = [row('x', 'y'), row('q')];
  const c = [row('x', 'y', 'z'), row('q')];

  it('unions without duplicates', () => {
    expect(keys(combineRows('union', [a, b]))).toEqual(['q', 'x', 'x>y', 'x>y>z']);
  });
  it('intersects: keeps only routes present in every operand', () => {
    expect(keys(combineRows('intersect', [a, b]))).toEqual(['x>y']);
    expect(keys(combineRows('intersect', [a, b, c]))).toEqual([]);
  });
  it('subtracts every later operand from the first one', () => {
    expect(keys(combineRows('except', [a, b]))).toEqual(['x', 'x>y>z']);
    expect(keys(combineRows('except', [a, b, c]))).toEqual(['x']);
  });
  it('distinguishes routes by node order', () => {
    expect(combineRows('intersect', [[row('a', 'b')], [row('b', 'a')]])).toEqual([]);
  });
  it('handles empty operands', () => {
    expect(combineRows('union', [])).toEqual([]);
    expect(combineRows('intersect', [a, []])).toEqual([]);
    expect(keys(combineRows('except', [a, []]))).toEqual(keys(a));
  });
});

describe('route ordering and ids', () => {
  it('sorts longest first and breaks ties by node ids', () => {
    const sorted = sortRows([row('b'), row('a', 'b'), row('a'), row('c', 'a', 'b'), row('a', 'a')]);
    expect(sorted.map((r) => routeKey(r.nodeIds))).toEqual(['c>a>b', 'a>a', 'a>b', 'a', 'b']);
  });
  it('compareRoutes is a consistent total order', () => {
    expect(compareRoutes(row('a'), row('a'))).toBe(0);
    expect(compareRoutes(row('a', 'b'), row('a'))).toBeLessThan(0);
  });
  it('builds routes with normalised edge ids, a stable id and the cycle marker', () => {
    const route = toRoute({ nodeIds: ['a', 'b', 'c'], closesTo: 'b' });
    expect(route.edgeIds).toEqual(['a->b', 'b->c']);
    expect(route.length).toBe(3);
    expect(route.closesTo).toBe('b');
    expect(route.id).toBe(toRoute({ nodeIds: ['a', 'b', 'c'] }).id);
    expect(route.id).not.toBe(toRoute({ nodeIds: ['a', 'c', 'b'] }).id);
    expect(toRoute({ nodeIds: ['solo'] }).edgeIds).toEqual([]);
  });
  it('hashString is stable', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
    expect(hashString('abc')).toMatch(/^[0-9a-f]{14}$/);
  });
});

describe('parseQueryRequest (validation, WorkPlan A5.1)', () => {
  const builder = {
    type: 'group',
    combinator: 'and',
    rules: [{ type: 'rule', position: 'first', path: 'kind', op: 'eq', value: 'rds' }],
  };
  const leaf = { op: 'leaf', builder };

  const fails = (input: unknown, code?: string) => {
    try {
      parseQueryRequest(input);
    } catch (e) {
      expect(e).toBeInstanceOf(QueryError);
      if (code) expect((e as QueryError).code).toBe(code);
      return;
    }
    throw new Error('expected a QueryError');
  };

  it('accepts builder leaves, raw leaves and nested set operations', () => {
    const req = parseQueryRequest({
      query: {
        op: 'except',
        args: [leaf, { op: 'union', args: [leaf, { op: 'leaf', text: 'MATCH (n {graphId: $g}) RETURN n' }] }],
      },
      limit: 50,
      maxHops: 5,
      routeMode: 'maximal',
    });
    expect(req.limit).toBe(50);
    expect(countConditions(req.query)).toBe(3);
  });
  it('rejects unknown fields, positions and operators', () => {
    fails({ query: leaf, extra: 1 });
    fails({
      query: {
        op: 'leaf',
        builder: { ...builder, rules: [{ type: 'rule', position: 'middle', path: 'a', op: 'eq' }] },
      },
    });
    fails({
      query: {
        op: 'leaf',
        builder: { ...builder, rules: [{ type: 'rule', position: 'first', path: 'a', op: 'like' }] },
      },
    });
  });
  it('requires exactly one of "builder" and "text" per leaf', () => {
    fails({ query: { op: 'leaf' } });
    fails({ query: { op: 'leaf', builder, text: 'MATCH' } });
  });
  it('requires at least two operands for "except" and one for the other operators', () => {
    fails({ query: { op: 'except', args: [leaf] } });
    fails({ query: { op: 'union', args: [] } });
  });
  it('enforces the limit ceilings', () => {
    fails({ query: leaf, limit: 10001 });
    fails({ query: leaf, maxHops: 101 });
    fails({ query: leaf, limit: 0 });
  });
  it('rejects queries with more than 200 conditions', () => {
    const rules = Array.from({ length: 201 }, () => builder.rules[0]);
    fails({ query: { op: 'leaf', builder: { ...builder, rules } } }, 'QUERY_TOO_LARGE');
  });
  it('counts nested conditions', () => {
    const nested = {
      type: 'group',
      combinator: 'or',
      rules: [
        builder.rules[0],
        { type: 'group', combinator: 'and', rules: [builder.rules[0], { type: 'length', min: 2 }] },
      ],
    };
    expect(countConditions({ op: 'leaf', builder: nested as never })).toBe(3);
  });
});
