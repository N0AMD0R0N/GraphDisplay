import type { Node } from '@xyflow/react';
import type { RuleGroupType } from 'react-querybuilder';
import type { GraphNode, GraphView } from '@gd/api-contract';
import type { QueryResult, RouteMode, SetOperator, SetTree } from '@gd/query-core';

/** Data objects of the client: what the logic modules, the store and the components pass around. */

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
}

export interface Highlight {
  nodes: Set<string>;
  edges: Set<string>;
}

export interface RouteSeverity {
  /** Highest severity rank on the route, or null when no node of the route has a vulnerability. */
  rank: number | null;
  /** The colour used for vulnerable nodes at that severity; black when there is none. */
  color: string;
}

/** One query of the panel. The queries are combined top to bottom: ((A op B) op C). */
export interface Block {
  id: number;
  mode: 'builder' | 'raw';
  rqb: RuleGroupType;
  text: string;
  /** How this query is combined with the ones above it (unused for the first). */
  op: SetOperator;
}

export interface CompiledBlocks {
  query: SetTree;
  /** Problems that keep the query from running (an empty value, an empty Cypher text...). */
  errors: string[];
}

/**
 * The state that is mirrored in the browser's address bar, so a query can be bookmarked and shared:
 *   ?graph=<id>&q=<set tree as JSON>&mode=maximal&hops=10&limit=500&run=1&route=3&view=graph
 * `q` uses the same JSON as the `q` parameter of GET /graphs/:id/routes/query.
 */
export interface UrlState {
  graph?: string;
  q?: SetTree;
  mode?: RouteMode;
  /** Sub-routes (routes that lie inside another route of the result) are included. */
  sub?: boolean;
  hops?: number;
  limit?: number;
  /** A query result is displayed (the page re-runs the query when it is opened). */
  run?: boolean;
  route?: number;
  view?: 'route' | 'graph';
}

export type ViewMode = 'route' | 'graph';

/** What is clicked in the whole-graph view: the routes leading up to a node or to the end of an edge are highlighted. */
export type Focus = { type: 'node'; id: string } | { type: 'edge'; id: string; from: string; to: string };

/** UI state (WorkPlan B2): server data lives in TanStack Query, everything else here. */
export interface UIState {
  graphId: string | null;
  drawerOpen: boolean;
  viewMode: ViewMode;
  result: QueryResult | null;
  selected: number;
  openNode: string | null;
  focus: Focus | null;
  /** The ranked view extended by "+N" / hidden-component expansions. */
  expandedView: GraphView | null;
  routeListOpen: boolean;
  /** Node to pan to and pulse (cycle marker click). */
  pulse: { nodeId: string; nonce: number } | null;

  setGraphId(id: string | null): void;
  toggleDrawer(): void;
  setViewMode(mode: ViewMode): void;
  setResult(result: QueryResult | null): void;
  /** Back to the whole graph: drops the query result and every highlight. */
  showFullGraph(): void;
  selectRoute(index: number): void;
  setOpenNode(id: string | null): void;
  setFocus(focus: Focus | null): void;
  /** Closes the details card and removes the highlight. */
  clearSelection(): void;
  setExpandedView(view: GraphView | null): void;
  setRouteListOpen(open: boolean): void;
  pulseNode(nodeId: string): void;
}

export interface FocusSummary {
  label: string;
  nodes: number;
  edges: number;
}

export interface OverlaysProps {
  view: GraphView | undefined;
  loading: boolean;
  error: string | null;
  expanding: boolean;
  focus: FocusSummary | null;
  onLoadComponent(nodeId: string): void;
}

/** Data carried by the nodes drawn on the canvas. */
export type KindData = {
  label: string;
  color: string;
  incomplete: boolean;
  dimmed: boolean;
  open: boolean;
  pulsing: boolean;
  /** Border colour of a node with vulnerabilities: light orange (low) to pinkish red (critical). */
  severityColor?: string;
  node: GraphNode;
};
export type GhostData = { target: string; color: string; dimmed: boolean };
export type StubData = { count: number; nodeId: string; dimmed: boolean };

export type KindFlowNode = Node<KindData, 'kind'>;
export type GhostFlowNode = Node<GhostData, 'ghost'>;
export type StubFlowNode = Node<StubData, 'stub'>;
