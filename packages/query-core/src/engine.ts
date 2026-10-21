import type { GraphEdge, GraphNode, GraphSummary, NormalizedGraph, Warning } from '@gd/api-contract';
import type { NativeQuery, QueryLimits, RunResult } from './model';

export interface TopologyNode {
  id: string;
  name: string;
  kind: string;
  degree: number;
  incomplete: boolean;
}

export interface Topology {
  nodes: TopologyNode[];
  /** [from, to] node-id pairs. */
  edges: [string, string][];
}

export interface StoreGraphInput {
  graphId: string;
  name: string;
  graph: NormalizedGraph;
  warnings: Warning[];
  pinned: boolean;
  /** Epoch ms after which the graph may be expired; null = never. */
  expiresAt: number | null;
}

/** Storage + query execution contract (WorkPlan §2.2). Implemented by `engine-neo4j`. */
export interface GraphEngine {
  init(): Promise<void>;
  /** Stores a graph. Idempotent by graphId; returns false when it already existed (expiry is refreshed). */
  store(input: StoreGraphInput): Promise<boolean>;
  run(graphId: string, query: NativeQuery, limits: QueryLimits): Promise<RunResult>;
  deleteGraph(graphId: string): Promise<void>;
  listGraphs(): Promise<GraphSummary[]>;
  getGraph(graphId: string): Promise<GraphSummary | null>;
  findExpired(now: number): Promise<string[]>;
  topology(graphId: string): Promise<Topology>;
  entities(graphId: string, nodeIds: string[], edgeIds: string[]): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;
  ping(): Promise<void>;
  close(): Promise<void>;
}
