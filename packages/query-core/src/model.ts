import type { EdgeId, GraphEdge, GraphNode, GraphSchema, NodeId, Warning } from '@gd/api-contract';

/** Language-agnostic query model (WorkPlan §2.2, §3.2). */

export type Position = 'first' | 'last' | 'any' | 'all' | 'none';
export const POSITIONS: Position[] = ['first', 'last', 'any', 'all', 'none'];

export type Operator =
  'eq' | 'neq' | 'in' | 'contains' | 'startsWith' | 'exists' | 'notExists' | 'gt' | 'gte' | 'lt' | 'lte';
export const OPERATORS: Operator[] = [
  'eq',
  'neq',
  'in',
  'contains',
  'startsWith',
  'exists',
  'notExists',
  'gt',
  'gte',
  'lt',
  'lte',
];

export type RuleValue = string | number | boolean | (string | number | boolean)[];

export interface NodeRule {
  type: 'rule';
  position: Position;
  path: string;
  op: Operator;
  value?: RuleValue;
}

export interface LengthRule {
  type: 'length';
  /** Node count, inclusive. */
  min?: number;
  max?: number;
}

export interface RuleGroup {
  type: 'group';
  combinator: 'and' | 'or';
  rules: Condition[];
}

export type Condition = NodeRule | LengthRule | RuleGroup;
export type ConditionTree = RuleGroup;

export type RouteMode = 'all' | 'maximal';

export interface QueryLeaf {
  op: 'leaf';
  /** Query language id; defaults to "cypher". */
  language?: string;
  /** Exactly one of `builder` / `text`. */
  builder?: ConditionTree;
  text?: string;
}

export type SetOperator = 'union' | 'intersect' | 'except';

export interface SetNode {
  op: SetOperator;
  args: SetTree[];
}

export type SetTree = QueryLeaf | SetNode;

export interface QueryRequest {
  query: SetTree;
  limit?: number;
  maxHops?: number;
  routeMode?: RouteMode;
}

export interface Route {
  id: string;
  nodeIds: NodeId[];
  edgeIds: EdgeId[];
  length: number;
  closesTo?: NodeId;
}

export interface QueryResult {
  routes: Route[];
  nodes: Record<NodeId, GraphNode>;
  edges: Record<EdgeId, GraphEdge>;
  total: number | null;
  truncated: boolean;
  warnings: Warning[];
}

/** A route as produced by an engine, before nodes/edges are attached. */
export interface RouteRow {
  nodeIds: NodeId[];
  closesTo?: NodeId;
}

export interface QueryLimits {
  limit: number;
  maxHops: number;
  timeoutMs?: number;
}

export interface CompileContext {
  graphId: string;
  maxHops: number;
  limit: number;
  routeMode: RouteMode;
  schema?: GraphSchema;
}

/** A query ready for an engine. `text` is engine-specific (Cypher for the Neo4j engine). */
export interface NativeQuery {
  language: string;
  kind: 'builder' | 'raw';
  text: string;
  params: Record<string, unknown>;
}

export interface RunResult {
  routes: RouteRow[];
  truncated: boolean;
}

export class QueryError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, code = 'INVALID_QUERY', status = 422) {
    super(message);
    this.name = 'QueryError';
    this.code = code;
    this.status = status;
  }
}

export interface QueryLanguage {
  id: string;
  compile(tree: ConditionTree, ctx: CompileContext): NativeQuery;
  prepare(raw: string, ctx: CompileContext): NativeQuery;
}
