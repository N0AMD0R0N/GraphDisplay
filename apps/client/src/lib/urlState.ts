import { parseQueryRequest, type QueryRequest } from '@gd/query-core';
import type { UrlState } from '../types';

/**
 * The address bar uses the routes of the public API (packages/api-contract/openapi.yaml), so an address of the UI is
 * an API request without the `/api` prefix:
 *   /graphs/<id>                                         the graph
 *   /graphs/<id>/routes/query?q=…&limit=…&maxHops=…&routeMode=…&includeSubRoutes=true   a route query
 * State that only the UI has (the selected route, the view, a query that was not run yet) is kept in the fragment
 * (`#route=3&view=graph`, `#draft`), which browsers never send to a server.
 */
const GRAPH_PATH = /^\/graphs\/([^/]+)(\/routes\/query)?\/?$/;

const positiveInt = (value: string | null): number | undefined => {
  if (value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};
const index = (value: string | null): number | undefined => {
  if (value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};

/** Reads the state from an address: path, query string and fragment. */
export function parseUrlState(address: string): UrlState {
  const url = new URL(address, 'http://ui.invalid');
  const state: UrlState = {};
  const match = GRAPH_PATH.exec(url.pathname);
  if (!match) return state;
  state.graph = decodeURIComponent(match[1]);
  if (!match[2]) return state;

  const p = url.searchParams;
  const rawQuery = p.get('q');
  if (rawQuery) {
    try {
      // validates the shape: an invalid query in a pasted URL is ignored rather than breaking the page
      state.query = parseQueryRequest({ query: JSON.parse(rawQuery) }).query;
    } catch {
      /* ignore */
    }
  }
  if (p.get('routeMode') === 'maximal') state.routeMode = 'maximal';
  const includeSub = p.get('includeSubRoutes');
  if (includeSub === 'true' || includeSub === '1') state.includeSubRoutes = true;
  const maxHops = positiveInt(p.get('maxHops'));
  if (maxHops) state.maxHops = maxHops;
  const limit = positiveInt(p.get('limit'));
  if (limit) state.limit = limit;

  const h = new URLSearchParams(url.hash.slice(1));
  if (h.has('draft')) state.draft = true;
  const route = index(h.get('route'));
  if (route !== undefined) state.route = route;
  if (h.get('view') === 'graph' || h.get('view') === 'route') state.view = h.get('view') as 'route' | 'graph';
  return state;
}

/** The address of a state; defaults and absent values are left out to keep it short. */
export function buildUrl(state: UrlState): string {
  if (!state.graph) return '/';
  const graphPath = `/graphs/${encodeURIComponent(state.graph)}`;
  if (!state.query) return graphPath;

  const search = queryString({
    query: state.query,
    limit: state.limit,
    maxHops: state.maxHops,
    routeMode: state.routeMode === 'maximal' ? 'maximal' : undefined,
    includeSubRoutes: state.includeSubRoutes,
  });
  const h = new URLSearchParams();
  if (state.draft) h.set('draft', '');
  else {
    if (state.route) h.set('route', String(state.route));
    if (state.view) h.set('view', state.view);
  }
  const hash = h.toString().replace(/=$|=(?=&)/g, '');
  return `${graphPath}/routes/query?${search}${hash ? `#${hash}` : ''}`;
}

/** The query string of GET /graphs/:id/routes/query. */
export function queryString(request: QueryRequest): string {
  const p = new URLSearchParams({ q: JSON.stringify(request.query) });
  if (request.limit !== undefined) p.set('limit', String(request.limit));
  if (request.maxHops !== undefined) p.set('maxHops', String(request.maxHops));
  if (request.routeMode !== undefined) p.set('routeMode', request.routeMode);
  if (request.includeSubRoutes) p.set('includeSubRoutes', 'true');
  return p.toString();
}
