import {
  QueryError,
  combineRows,
  compareRoutes,
  dropSubRoutes,
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

describe('dropSubRoutes (no returned route is part of another)', () => {
  const r = (ids: string, closesTo?: string): RouteRow => ({
    nodeIds: ids.split('>'),
    ...(closesTo ? { closesTo } : {}),
  });
  const out = (rows: RouteRow[]) => dropSubRoutes(rows).map((x) => routeKey(x.nodeIds));

  it('leaves out every route that is a contiguous part of a longer one', () => {
    expect(out([r('a'), r('a>b'), r('b>c'), r('b'), r('a>b>c'), r('c')])).toEqual(['a>b>c']);
  });

  it('compares members AND order: the same nodes the other way round, or with a gap, are different routes', () => {
    expect(out([r('a>b>c'), r('c>b')])).toEqual(['a>b>c', 'c>b']);
    expect(out([r('a>b>c'), r('a>c')])).toEqual(['a>b>c', 'a>c']);
  });

  it('finds a sub-route at the start, in the middle and at the end', () => {
    const long = r('a>b>c>d>e');
    expect(out([long, r('a>b'), r('c>d'), r('d>e'), r('b>c>d')])).toEqual(['a>b>c>d>e']);
  });

  it('keeps a route when the longer route is not in the list', () => {
    expect(out([r('b'), r('c>d')])).toEqual(['c>d', 'b']);
    expect(out([r('a>b'), r('b')])).toEqual(['a>b']);
    expect(out([r('x>y'), r('y>z')])).toEqual(['x>y', 'y>z']); // they overlap, but neither contains the other
  });

  it('keeps lone nodes that no route contains and drops the ones that are on a route', () => {
    expect(out([r('lonely'), r('a>b'), r('a'), r('b')])).toEqual(['a>b', 'lonely']);
  });

  it('keeps the cycle marker of the routes that remain, and sorts longest first', () => {
    const kept = dropSubRoutes([r('b>c>d', 'b'), r('a>b>c>d', 'b'), r('c>d>b', 'c'), r('d')]);
    expect(kept.map((x) => [routeKey(x.nodeIds), x.closesTo])).toEqual([
      ['a>b>c>d', 'b'],
      ['c>d>b', 'c'],
    ]);
  });

  it('handles an empty list, a single route and the same list twice', () => {
    expect(dropSubRoutes([])).toEqual([]);
    expect(out([r('a>b')])).toEqual(['a>b']);
    expect(out([r('a>b>c'), r('a>b>c')])).toEqual(['a>b>c']); // an identical route counts as contained
  });

  it('gives the same result as comparing every pair (random simple paths over 9 nodes)', () => {
    let seed = 12345;
    const random = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed % n;
    };
    const nodes = 'abcdefghi'.split('');
    const rows: RouteRow[] = [];
    const seen = new Set<string>();
    while (rows.length < 400) {
      const pool = [...nodes];
      const ids: string[] = [];
      for (let n = 1 + random(7); n > 0; n--) ids.push(pool.splice(random(pool.length), 1)[0]);
      const key = ids.join('>');
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({ nodeIds: ids });
      }
    }
    const inside = (a: string[], b: string[]) => {
      if (a.length >= b.length) return false;
      for (let s = 0; s + a.length <= b.length; s++) if (a.every((x, i) => b[s + i] === x)) return true;
      return false;
    };
    const expected = rows
      .filter((x) => !rows.some((o) => inside(x.nodeIds, o.nodeIds)))
      .map((x) => routeKey(x.nodeIds))
      .sort();
    expect(out(rows).sort()).toEqual(expected);
    expect(expected.length).toBeGreaterThan(20);
    expect(expected.length).toBeLessThan(rows.length);
  });

  it('is fast on a large list (10,000 routes of up to 40 nodes)', () => {
    const rows: RouteRow[] = [];
    for (let i = 0; i < 10_000; i++) {
      const length = 5 + (i % 36);
      rows.push({
        nodeIds: Array.from({ length }, (_, j) => `n${(i * 7 + j * 13) % 900}`).filter(
          (v, k, all) => all.indexOf(v) === k,
        ),
      });
    }
    const start = performance.now();
    const kept = dropSubRoutes(rows);
    expect(performance.now() - start).toBeLessThan(3000);
    expect(kept.length).toBeGreaterThan(0);
  });
});
