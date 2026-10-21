/**
 * Shared wire types for the Graph Display public API (see openapi.yaml, the source of truth).
 * Nothing in this package depends on a query language or a storage engine.
 */

export type NodeId = string;
export type EdgeId = string;
export type Primitive = string | number | boolean;
export type FlatValue = Primitive | Primitive[];

/** Trim + lower-case: the canonical form used for ids and queryable values (WorkPlan §3.1). */
export function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

export const edgeIdOf = (from: NodeId, to: NodeId): EdgeId => `${from}->${to}`;

// ---------------------------------------------------------------- input graph

export interface InputNode {
  name: string;
  kind?: string;
  [key: string]: unknown;
}

export interface InputEdgeGroup {
  from: string;
  to: string | string[];
  [key: string]: unknown;
}

export interface InputGraph {
  nodes: InputNode[];
  edges?: InputEdgeGroup[];
}

// ---------------------------------------------------------- normalised graph

/** A node as returned to API consumers: all original properties plus `id` and `incomplete`. */
export interface GraphNode {
  id: NodeId;
  name: string;
  kind?: string;
  incomplete?: boolean;
  [key: string]: unknown;
}

export interface GraphEdge {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
  [key: string]: unknown;
}

export interface StoredNode {
  id: NodeId;
  name: string;
  kind: string;
  incomplete: boolean;
  /** Original node object (strings trimmed, original casing kept). */
  raw: Record<string, unknown>;
  /** Flattened, queryable properties incl. derived ones (WorkPlan §3.1, §3.1.1). */
  props: Record<string, FlatValue>;
}

export interface StoredEdge {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
  extra?: Record<string, unknown>;
}

export interface NormalizedGraph {
  nodes: StoredNode[];
  edges: StoredEdge[];
}

// ------------------------------------------------------------------- warnings

export type WarningCode =
  | 'MISSING_NODE'
  | 'DUPLICATE_EDGE'
  | 'CYCLE'
  | 'UNKNOWN_SEVERITY'
  | 'TRUNCATED'
  | 'APPROXIMATE_SET_OPERATION'
  | 'COERCED_VALUE';

export interface Warning {
  code: WarningCode;
  message: string;
  ref?: string;
}

/** A per-issue entry of a 207 response: data was missing but could be derived. */
export interface IssueEntry {
  status: 422;
  code: 'MISSING_NODE';
  ref: string;
  message: string;
}

// -------------------------------------------------------------- graph resource

export type GraphStatus = 'complete' | 'incomplete';

export interface GraphCounts {
  nodes: number;
  edges: number;
  placeholders: number;
}

export interface GraphSummary {
  graphId: string;
  name: string;
  status: GraphStatus;
  counts: GraphCounts;
  createdAt: number;
  expiresAt: number | null;
  pinned: boolean;
  warnings: Warning[];
}

export interface UploadResponse extends GraphSummary {
  /** Present with HTTP 207: one 422 entry per derived (missing) element. */
  results?: IssueEntry[];
  /** True when the same graph content already existed. */
  existing?: boolean;
}

export interface ApiError {
  error: {
    status: number;
    code: string;
    message: string;
    issues?: { path?: string; message: string }[];
  };
}

// --------------------------------------------------------------------- schema

export interface PropertyInfo {
  path: string;
  type: 'string' | 'number' | 'boolean';
  list: boolean;
  /** Number of nodes having the property. */
  count: number;
  distinct: number;
  /** Observed values with counts (only when few distinct values). */
  values?: { value: Primitive; count: number }[];
  min?: number;
  max?: number;
}

export interface KindInfo {
  kind: string;
  count: number;
  color: string;
}

export interface GraphSchema {
  graphId: string;
  nodeCount: number;
  edgeCount: number;
  kinds: KindInfo[];
  properties: PropertyInfo[];
  sinkKinds: string[];
  severityScale: Record<string, number>;
}

// ----------------------------------------------------------------------- view

export interface ViewNode {
  node: GraphNode;
  x: number;
  y: number;
  degree: number;
}

export interface ViewEdge {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
}

/** "+N" overflow indicator attached to a node that has hidden neighbours. */
export interface ViewStub {
  id: string;
  nodeId: NodeId;
  count: number;
  x: number;
  y: number;
}

export interface HiddenComponent {
  rootId: NodeId;
  size: number;
  sample: string[];
}

export interface GraphView {
  graphId: string;
  nodes: ViewNode[];
  edges: ViewEdge[];
  stubs: ViewStub[];
  hiddenComponents: HiddenComponent[];
  hiddenComponentCount: number;
  totalNodes: number;
  shownNodes: number;
}

export interface ExpandRequest {
  nodeId: NodeId;
  mode: 'neighbors' | 'component';
  visible: { id: NodeId; x: number; y: number }[];
}

// ------------------------------------------------------------------- constants

export const DEFAULTS = {
  maxHops: 50,
  maxHopsCeiling: 100,
  limit: 1000,
  limitCeiling: 10000,
  viewNodeCap: 200,
  maxQueryLeaves: 200,
  colorMinHueDistance: 30,
} as const;
export * from './transport';
export * from './constants';
export * from './colors';
