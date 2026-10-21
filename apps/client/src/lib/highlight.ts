import type { FlowEdge, Highlight } from '../types';

/**
 * The routes that lead *up to* a node: every node from which `target` can be reached, and every edge on such a
 * route. This is the union of all routes ending at the target, so it is computed with one reverse search instead
 * of enumerating the (possibly very many) individual routes. An edge is on such a route when it points into the
 * set (its source is then an ancestor as well).
 */
export function upstreamOf(target: string, edges: readonly FlowEdge[]): Highlight {
  const incoming = new Map<string, FlowEdge[]>();
  for (const e of edges) {
    const list = incoming.get(e.to);
    if (list) list.push(e);
    else incoming.set(e.to, [e]);
  }
  const nodes = new Set<string>([target]);
  const queue = [target];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const e of incoming.get(current) ?? []) {
      if (!nodes.has(e.from)) {
        nodes.add(e.from);
        queue.push(e.from);
      }
    }
  }
  const onRoute = new Set<string>();
  for (const e of edges) if (nodes.has(e.to)) onRoute.add(e.id);
  return { nodes, edges: onRoute };
}

/**
 * Highlight for a clicked edge (from -> to): only the routes that end at `to` **and contain this edge**. A route ends
 * at `to` only once, so the edge is its last step; the rest of the route is any route up to `from` that does not
 * pass through `to` (a route never visits a node twice). Routes up to `to` through its other incoming edges are
 * not part of the highlight.
 */
export function upstreamOfEdge(edge: FlowEdge, edges: readonly FlowEdge[]): Highlight {
  const withoutEnd = edges.filter((e) => e.from !== edge.to && e.to !== edge.to);
  const h = upstreamOf(edge.from, withoutEnd);
  h.nodes.add(edge.to);
  h.edges.add(edge.id);
  return h;
}
