import { GhostNode, KindNode, StubNode } from './nodes';

/** Defined once, outside any component, so React Flow does not re-create the node renderers. */
export const nodeTypes = { kind: KindNode, ghost: GhostNode, stub: StubNode };
