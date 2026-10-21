import ELK from 'elkjs/lib/elk.bundled.js';
import { LAYOUT_BOX, STUB_ID_PREFIX } from './constants';
import type { LayoutInput, LayoutResult } from './types';

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
      ...input.nodeIds.map((id) => ({ id, width: LAYOUT_BOX.node.width, height: LAYOUT_BOX.node.height })),
      ...input.stubParents.map((id) => ({
        id: `${STUB_ID_PREFIX}${id}`,
        width: LAYOUT_BOX.stub.width,
        height: LAYOUT_BOX.stub.height,
      })),
    ],
    edges: [
      ...input.edges
        .filter((e) => ids.has(e.from) && ids.has(e.to))
        .map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
      ...input.stubParents.map((id) => ({ id: `stub-edge:${id}`, sources: [id], targets: [`${STUB_ID_PREFIX}${id}`] })),
    ],
  });
  const result: LayoutResult = { nodes: {}, stubs: {} };
  for (const child of graph.children ?? []) {
    const p = { x: Math.round(child.x ?? 0), y: Math.round(child.y ?? 0) };
    if (child.id.startsWith(STUB_ID_PREFIX)) result.stubs[child.id.slice(STUB_ID_PREFIX.length)] = p;
    else result.nodes[child.id] = p;
  }
  return result;
}
