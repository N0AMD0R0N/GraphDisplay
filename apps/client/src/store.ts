import { create } from 'zustand';
import type { GraphView } from '@gd/api-contract';
import type { QueryResult } from '@gd/query-core';

export type ViewMode = 'route' | 'graph';

/** What is clicked in the whole-graph view: the routes leading up to a node or to the end of an edge are highlighted. */
export type Focus = { type: 'node'; id: string } | { type: 'edge'; id: string; from: string; to: string };

/** UI state (WorkPlan B2): server data lives in TanStack Query, everything else here. */
interface UIState {
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

const NO_SELECTION = { openNode: null, focus: null } as const;

export const useUI = create<UIState>((set, get) => ({
  graphId: null,
  drawerOpen: true,
  viewMode: 'graph',
  result: null,
  selected: 0,
  openNode: null,
  focus: null,
  expandedView: null,
  routeListOpen: false,
  pulse: null,

  setGraphId: (graphId) =>
    set({
      graphId,
      result: null,
      selected: 0,
      ...NO_SELECTION,
      expandedView: null,
      viewMode: 'graph',
      routeListOpen: false,
    }),
  toggleDrawer: () => set({ drawerOpen: !get().drawerOpen }),
  setViewMode: (viewMode) => set({ viewMode, ...NO_SELECTION, expandedView: null }),
  setResult: (result) =>
    set({
      result,
      selected: 0,
      ...NO_SELECTION,
      expandedView: null,
      routeListOpen: false,
      viewMode: result ? 'route' : 'graph',
    }),
  showFullGraph: () =>
    set({
      result: null,
      selected: 0,
      ...NO_SELECTION,
      expandedView: null,
      routeListOpen: false,
      viewMode: 'graph',
    }),
  selectRoute: (index) => {
    const n = get().result?.routes.length ?? 0;
    if (n === 0) return;
    set({ selected: ((index % n) + n) % n, ...NO_SELECTION, expandedView: null });
  },
  setOpenNode: (openNode) => set({ openNode }),
  setFocus: (focus) => set({ focus }),
  clearSelection: () => set({ ...NO_SELECTION }),
  setExpandedView: (expandedView) => set({ expandedView }),
  setRouteListOpen: (routeListOpen) => set({ routeListOpen }),
  pulseNode: (nodeId) => {
    const nonce = Date.now();
    set({ pulse: { nodeId, nonce } });
    // the pulse ring fades after a moment
    setTimeout(() => set((s) => (s.pulse?.nonce === nonce ? { pulse: null } : s)), 2000);
  },
}));
