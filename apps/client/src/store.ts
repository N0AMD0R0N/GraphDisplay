import { create } from 'zustand';
import type { UIState } from './types';

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
