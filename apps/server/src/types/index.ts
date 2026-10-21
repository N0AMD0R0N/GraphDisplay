import type { DalClient } from '@gd/dal-contract';
import type { IngestClient } from '@gd/ingest-contract';
import type { QueryLanguage } from '@gd/query-core';

export interface ServerLimits {
  maxHops: number;
  defaultLimit: number;
}

/** What createServer needs from the outside. */
export interface ServerDeps {
  dal: DalClient;
  ingest: IngestClient;
  limits: ServerLimits;
  maxUploadBytes: number;
  logger?: boolean;
  languages?: QueryLanguage[];
}

/** What the query service works with. */
export interface QueryDeps {
  dal: DalClient;
  ingest: IngestClient;
  languages: Map<string, QueryLanguage>;
  limits: ServerLimits;
}

/** What the view service works with. */
export interface ViewDeps {
  dal: DalClient;
}

/** A graph topology indexed for the view: degrees, names, undirected neighbours, edges. */
export interface ViewIndex {
  degree: Map<string, number>;
  names: Map<string, string>;
  neighbours: Map<string, Set<string>>;
  edges: { id: string; from: string; to: string }[];
}

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
