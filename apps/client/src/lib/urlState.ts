import { parseQueryRequest, type QueryRequest } from '@gd/query-core';
import type { UrlState } from '../types';

const positiveInt = (value: string | null): number | undefined => {
  if (value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};

export function parseUrlState(search: string): UrlState {
  const p = new URLSearchParams(search);
  const state: UrlState = {};
  if (p.get('graph')) state.graph = p.get('graph')!;

  const rawQuery = p.get('q');
  if (rawQuery) {
    try {
      // validates the shape: an invalid query in a pasted URL is ignored rather than breaking the page
      state.q = parseQueryRequest({ query: JSON.parse(rawQuery) }).query;
    } catch {
      /* ignore */
    }
  }
  if (p.get('mode') === 'maximal') state.mode = 'maximal';
  if (p.get('sub') === '1') state.sub = true;
  const hops = positiveInt(p.get('hops'));
  if (hops) state.hops = hops;
  const limit = positiveInt(p.get('limit'));
  if (limit) state.limit = limit;
  if (p.get('run') === '1') state.run = true;
  const route = positiveInt(p.get('route'));
  if (route !== undefined) state.route = route;
  if (p.get('view') === 'graph' || p.get('view') === 'route') state.view = p.get('view') as 'route' | 'graph';
  return state;
}

/** Serialises the state; defaults and absent values are left out to keep the URL short. */
export function buildSearch(state: UrlState): string {
  const p = new URLSearchParams();
  if (state.graph) p.set('graph', state.graph);
  if (state.q) p.set('q', JSON.stringify(state.q));
  if (state.mode === 'maximal') p.set('mode', 'maximal');
  if (state.sub) p.set('sub', '1');
  if (state.hops) p.set('hops', String(state.hops));
  if (state.limit) p.set('limit', String(state.limit));
  if (state.run) {
    p.set('run', '1');
    if (state.route) p.set('route', String(state.route));
    if (state.view) p.set('view', state.view);
  }
  const text = p.toString();
  return text ? `?${text}` : '';
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
