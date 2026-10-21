import { edgeIdOf } from '@gd/api-contract';
import type { Route, RouteRow, SetOperator } from './model';

/** Canonical route key: the ordered node ids (WorkPlan A5). */
export const routeKey = (nodeIds: readonly string[]): string => nodeIds.join('>');

/** Small, stable, non-cryptographic 53-bit string hash (cyrb53), hex encoded. */
export function hashString(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Longest first; ties broken by node ids in order (A4.3). */
export function compareRoutes(a: { nodeIds: readonly string[] }, b: { nodeIds: readonly string[] }): number {
  if (a.nodeIds.length !== b.nodeIds.length) return b.nodeIds.length - a.nodeIds.length;
  for (let i = 0; i < a.nodeIds.length; i++) {
    if (a.nodeIds[i] !== b.nodeIds[i]) return a.nodeIds[i] < b.nodeIds[i] ? -1 : 1;
  }
  return 0;
}

/** Combines route sets with union / intersect / except. `except` = first minus all others. */
export function combineRows(op: SetOperator, sets: RouteRow[][]): RouteRow[] {
  if (sets.length === 0) return [];
  const keyed = sets.map((rows) => {
    const m = new Map<string, RouteRow>();
    for (const r of rows) m.set(routeKey(r.nodeIds), r);
    return m;
  });
  const [first, ...rest] = keyed;
  const out = new Map<string, RouteRow>();
  if (op === 'union') {
    for (const m of keyed) for (const [k, r] of m) if (!out.has(k)) out.set(k, r);
  } else if (op === 'intersect') {
    for (const [k, r] of first) if (rest.every((m) => m.has(k))) out.set(k, r);
  } else {
    for (const [k, r] of first) if (rest.every((m) => !m.has(k))) out.set(k, r);
  }
  return [...out.values()];
}

export function toRoute(row: RouteRow): Route {
  const edgeIds: string[] = [];
  for (let i = 0; i + 1 < row.nodeIds.length; i++) edgeIds.push(edgeIdOf(row.nodeIds[i], row.nodeIds[i + 1]));
  const route: Route = {
    id: hashString(routeKey(row.nodeIds)),
    nodeIds: row.nodeIds,
    edgeIds,
    length: row.nodeIds.length,
  };
  if (row.closesTo) route.closesTo = row.closesTo;
  return route;
}

export function sortRows(rows: RouteRow[]): RouteRow[] {
  return [...rows].sort(compareRoutes);
}
