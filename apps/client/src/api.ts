import { useQuery } from '@tanstack/react-query';
import type { ApiError, ExpandRequest, GraphSchema, GraphSummary, GraphView, UploadResponse } from '@gd/api-contract';
import type { QueryRequest, QueryResult } from '@gd/query-core';
import { queryString } from './lib/urlState';
import { API_BASE } from './constants';

const BASE = import.meta.env.VITE_API_BASE ?? API_BASE;

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError('The server cannot be reached', 0, 'NETWORK');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok && res.status !== 207) {
    const err = (data as ApiError | undefined)?.error;
    throw new ApiRequestError(err?.message ?? `Request failed (${res.status})`, res.status, err?.code ?? 'ERROR');
  }
  return { status: res.status, data: data as T };
}

export const api = {
  graphs: async () => (await request<GraphSummary[]>('GET', '/graphs')).data,
  schema: async (id: string) => (await request<GraphSchema>('GET', `/graphs/${id}/schema`)).data,
  view: async (id: string, pins: string[] = []) =>
    (
      await request<GraphView>(
        'GET',
        `/graphs/${id}/view${pins.length ? `?pin=${encodeURIComponent(pins.join(','))}` : ''}`,
      )
    ).data,
  expand: async (id: string, body: ExpandRequest) =>
    (await request<GraphView>('POST', `/graphs/${id}/view/expand`, body)).data,
  query: async (id: string, body: QueryRequest) =>
    (await request<QueryResult>('GET', `/graphs/${id}/routes/query?${queryString(body)}`)).data,
  upload: async (text: string, name?: string) => {
    const res = await request<UploadResponse>(
      'POST',
      `/graphs${name ? `?name=${encodeURIComponent(name)}` : ''}`,
      text,
    );
    return { status: res.status, graph: res.data };
  },
};

export const useGraphs = () => useQuery({ queryKey: ['graphs'], queryFn: api.graphs });

export const useSchema = (graphId: string | null) =>
  useQuery({ queryKey: ['schema', graphId], queryFn: () => api.schema(graphId!), enabled: !!graphId });

export const useView = (graphId: string | null, pins: string[], enabled = true) =>
  useQuery({
    queryKey: ['view', graphId, [...pins].sort().join(',')],
    queryFn: () => api.view(graphId!, pins),
    enabled: !!graphId && enabled,
    placeholderData: (previous) => previous,
  });
