import {
  DEFAULTS,
  type ExpandRequest,
  type GraphNode,
  type GraphView,
  type HiddenComponent,
  type ViewNode,
  type ViewStub,
} from '@gd/api-contract';
import type { DalClient } from '@gd/dal-contract';
import { hashString, QueryError, type Topology } from '@gd/query-core';
import { layoutGraph, type Point } from './layout';

/** Graph view: degree ranking, node cap, "+N" stubs, hidden components (WorkPlan C6.1, C7, B5.1). */

interface Index {
  degree: Map<string, number>;
  names: Map<string, string>;
  neighbours: Map<string, Set<string>>;
  edges: { id: string; from: string; to: string }[];
}

function indexTopology(t: Topology): Index {
  const degree = new Map<string, number>();
  const names = new Map<string, string>();
  const neighbours = new Map<string, Set<string>>();
  for (const n of t.nodes) {
    degree.set(n.id, n.degree);
    names.set(n.id, n.name);
    neighbours.set(n.id, new Set());
  }
  const edges = t.edges.map(([from, to]) => {
    neighbours.get(from)?.add(to);
    neighbours.get(to)?.add(from);
    return { id: `${from}->${to}`, from, to };
  });
  return { degree, names, neighbours, edges };
}

const byDegree = (ix: Index) => (a: string, b: string) =>
  (ix.degree.get(b) ?? 0) - (ix.degree.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0);

function rank(ids: Iterable<string>, ix: Index): string[] {
  return [...ids].sort(byDegree(ix));
}

function hiddenComponents(ix: Index, shown: Set<string>): { list: HiddenComponent[]; count: number } {
  const seen = new Set<string>();
  const comps: HiddenComponent[] = [];
  for (const start of rank(ix.degree.keys(), ix)) {
    if (seen.has(start)) continue;
    const members: string[] = [];
    let touchesShown = false;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const u = stack.pop()!;
      members.push(u);
      if (shown.has(u)) touchesShown = true;
      for (const w of ix.neighbours.get(u) ?? []) {
        if (!seen.has(w)) {
          seen.add(w);
          stack.push(w);
        }
      }
    }
    if (touchesShown) continue;
    const ranked = rank(members, ix);
    comps.push({
      rootId: ranked[0],
      size: members.length,
      sample: ranked.slice(0, 5).map((id) => ix.names.get(id) ?? id),
    });
  }
  comps.sort((a, b) => b.size - a.size || (a.rootId < b.rootId ? -1 : 1));
  return { list: comps.slice(0, 50), count: comps.length };
}

async function fetchNodes(dal: DalClient, graphId: string, ids: string[]): Promise<Map<string, GraphNode>> {
  const out = new Map<string, GraphNode>();
  for (let i = 0; i < ids.length; i += 1000) {
    const res = await dal.entities(graphId, { nodeIds: ids.slice(i, i + 1000), edgeIds: [] });
    for (const n of res.nodes) out.set(n.id, n);
  }
  return out;
}

async function assemble(
  dal: DalClient,
  graphId: string,
  ix: Index,
  selected: string[],
  positions: Map<string, Point>,
  stubPositions: Map<string, Point>,
): Promise<GraphView> {
  const shown = new Set(selected);
  const nodes = await fetchNodes(dal, graphId, selected);
  const viewNodes: ViewNode[] = [];
  for (const id of selected) {
    const node = nodes.get(id);
    const p = positions.get(id);
    if (!node || !p) continue;
    viewNodes.push({ node, x: p.x, y: p.y, degree: ix.degree.get(id) ?? 0 });
  }
  const stubs: ViewStub[] = [];
  for (const id of selected) {
    let hidden = 0;
    for (const w of ix.neighbours.get(id) ?? []) if (!shown.has(w)) hidden++;
    if (hidden === 0) continue;
    const parent = positions.get(id)!;
    const p = stubPositions.get(id) ?? { x: parent.x + 150, y: parent.y + 14 };
    stubs.push({ id: `stub:${id}`, nodeId: id, count: hidden, x: p.x, y: p.y });
  }
  const comps = hiddenComponents(ix, shown);
  return {
    graphId,
    nodes: viewNodes,
    edges: ix.edges.filter((e) => shown.has(e.from) && shown.has(e.to)),
    stubs,
    hiddenComponents: comps.list,
    hiddenComponentCount: comps.count,
    totalNodes: ix.degree.size,
    shownNodes: viewNodes.length,
  };
}

function stubParentsOf(ix: Index, ids: string[], shown: Set<string>): string[] {
  return ids.filter((id) => [...(ix.neighbours.get(id) ?? [])].some((w) => !shown.has(w)));
}

export interface ViewDeps {
  dal: DalClient;
}

/** The ranked top-N view (cached through the DAL by view key). */
export async function getView(
  { dal }: ViewDeps,
  graphId: string,
  opts: { pins?: string[]; cap?: number } = {},
): Promise<GraphView> {
  const cap = Math.min(Math.max(opts.cap ?? DEFAULTS.viewNodeCap, 1), 500);
  const key = hashString(JSON.stringify({ cap, pins: [...(opts.pins ?? [])].sort() }));
  const cached = await dal.cacheGet<GraphView>(graphId, 'view', key);
  if (cached) return cached;

  const topology = await dal.topology(graphId);
  const ix = indexTopology(topology);
  const pins = [...new Set(opts.pins ?? [])].filter((id) => ix.degree.has(id));
  const pinSet = new Set(pins);
  const rest = rank(ix.degree.keys(), ix).filter((id) => !pinSet.has(id));
  const selected = [...pins, ...rest.slice(0, Math.max(0, cap - pins.length))];
  const shown = new Set(selected);

  const layout = await layoutGraph({
    nodeIds: selected,
    edges: ix.edges,
    stubParents: stubParentsOf(ix, selected, shown),
  });
  const view = await assemble(
    dal,
    graphId,
    ix,
    selected,
    new Map(Object.entries(layout.nodes)),
    new Map(Object.entries(layout.stubs)),
  );
  await dal.cachePut(graphId, 'view', view, key);
  return view;
}

/**
 * Expands the view around a node ("+N" stub) or loads a hidden component (C7). Existing nodes keep their
 * positions (B5.1); the new nodes are laid out as a block to the right of them.
 */
export async function expandView(
  { dal }: ViewDeps,
  graphId: string,
  req: ExpandRequest,
  cap = DEFAULTS.viewNodeCap,
): Promise<GraphView> {
  const topology = await dal.topology(graphId);
  const ix = indexTopology(topology);
  if (!ix.degree.has(req.nodeId)) throw new QueryError(`Unknown node "${req.nodeId}"`, 'NODE_NOT_FOUND', 404);

  const visible = req.visible.filter((v) => ix.degree.has(v.id));
  const shown = new Set(visible.map((v) => v.id));

  let candidates: Set<string>;
  if (req.mode === 'component') {
    candidates = new Set<string>();
    const stack = [req.nodeId];
    candidates.add(req.nodeId);
    while (stack.length) {
      const u = stack.pop()!;
      for (const w of ix.neighbours.get(u) ?? []) {
        if (!candidates.has(w)) {
          candidates.add(w);
          stack.push(w);
        }
      }
    }
  } else {
    candidates = new Set(ix.neighbours.get(req.nodeId) ?? []);
  }
  const added = rank(
    [...candidates].filter((id) => !shown.has(id)),
    ix,
  ).slice(0, cap);
  const selected = [...visible.map((v) => v.id), ...added];
  const all = new Set(selected);

  const layout = await layoutGraph({
    nodeIds: added,
    edges: ix.edges,
    stubParents: stubParentsOf(ix, added, all),
  });
  const maxX = visible.length ? Math.max(...visible.map((v) => v.x)) : -260;
  const minY = visible.length ? Math.min(...visible.map((v) => v.y)) : 0;
  const positions = new Map<string, Point>(visible.map((v) => [v.id, { x: v.x, y: v.y }]));
  for (const [id, p] of Object.entries(layout.nodes)) {
    positions.set(id, { x: p.x + maxX + 260, y: p.y + minY });
  }
  const stubPositions = new Map<string, Point>(
    Object.entries(layout.stubs).map(([id, p]) => [id, { x: p.x + maxX + 260, y: p.y + minY }]),
  );
  return assemble(dal, graphId, ix, selected, positions, stubPositions);
}
