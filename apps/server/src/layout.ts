import ELK from 'elkjs/lib/elk.bundled.js';

export const NODE_W = 120;
export const NODE_H = 56;
export const STUB_W = 56;
export const STUB_H = 28;

export interface LayoutInput {
  nodeIds: string[];
  edges: { id: string; from: string; to: string }[];
  /** Nodes that get a "+N" stub; laid out next to their node. */
  stubParents: string[];
}

export interface Point {
  x: number;
  y: number;
}

export interface LayoutResult {
  nodes: Record<string, Point>;
  stubs: Record<string, Point>;
}

const elk = new ELK();

/** Layered left-to-right layout (callers on the left, callees on the right) - B5. */
export async function layoutGraph(input: LayoutInput): Promise<LayoutResult> {
  if (input.nodeIds.length === 0) return { nodes: {}, stubs: {} };
  const ids = new Set(input.nodeIds);
  const graph = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.spacing.nodeNode': '26',
      'elk.spacing.componentComponent': '60',
      'elk.separateConnectedComponents': 'true',
    },
    children: [
      ...input.nodeIds.map((id) => ({ id, width: NODE_W, height: NODE_H })),
      ...input.stubParents.map((id) => ({ id: `stub:${id}`, width: STUB_W, height: STUB_H })),
    ],
    edges: [
      ...input.edges
        .filter((e) => ids.has(e.from) && ids.has(e.to))
        .map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
      ...input.stubParents.map((id) => ({ id: `stub-edge:${id}`, sources: [id], targets: [`stub:${id}`] })),
    ],
  });
  const result: LayoutResult = { nodes: {}, stubs: {} };
  for (const child of graph.children ?? []) {
    const p = { x: Math.round(child.x ?? 0), y: Math.round(child.y ?? 0) };
    if (child.id.startsWith('stub:')) result.stubs[child.id.slice(5)] = p;
    else result.nodes[child.id] = p;
  }
  return result;
}
