import {
  ServiceCallError,
  type GraphEdge,
  type GraphNode,
  type GraphSummary,
  type NormalizedGraph,
  type Transport,
  type Warning,
} from '@gd/api-contract';
import type { NativeQuery, RunResult, Topology } from '@gd/query-core';

/** Internal Data Access Layer contract (dal.openapi.yaml is the source of truth). */

export interface PutGraphBody {
  name: string;
  graph: NormalizedGraph;
  warnings: Warning[];
  pinned: boolean;
}

export interface PutGraphResponse {
  created: boolean;
  summary: GraphSummary;
}

export interface RunBody {
  query: NativeQuery;
  limit: number;
  maxHops: number;
  timeoutMs?: number;
}

export interface RunResponse extends RunResult {
  cached: boolean;
}

export interface EntitiesBody {
  nodeIds: string[];
  edgeIds: string[];
}

export interface EntitiesResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type ColorMap = Record<string, string>;

export interface HealthResponse {
  status: 'ok' | 'degraded';
  neo4j: boolean;
  redis: boolean;
}

export interface ExpireResponse {
  skipped: boolean;
  reason?: string;
  deleted: string[];
}

export type Artifact = 'schema' | 'topology' | 'layout' | 'view' | 'q';

export class DalClient {
  constructor(private readonly t: Transport) {}

  private async expect<T>(
    method: string,
    path: string,
    ok: number[],
    opts?: Parameters<Transport['request']>[2],
  ): Promise<T> {
    const res = await this.t.request<T>(method, path, opts);
    if (!ok.includes(res.status)) {
      throw new ServiceCallError(`DAL ${method} ${path} -> ${res.status}`, res.status, res.body);
    }
    return res.body;
  }

  health(): Promise<HealthResponse> {
    return this.t.request<HealthResponse>('GET', '/dal/health').then((r) => r.body);
  }

  putGraph(graphId: string, body: PutGraphBody): Promise<PutGraphResponse> {
    return this.expect('PUT', `/dal/graphs/${graphId}`, [200, 201], { body });
  }

  listGraphs(): Promise<GraphSummary[]> {
    return this.expect('GET', '/dal/graphs', [200]);
  }

  async getGraph(graphId: string): Promise<GraphSummary | null> {
    const res = await this.t.request<GraphSummary>('GET', `/dal/graphs/${graphId}`);
    if (res.status === 404) return null;
    if (res.status !== 200) throw new ServiceCallError(`DAL get graph -> ${res.status}`, res.status, res.body);
    return res.body;
  }

  async deleteGraph(graphId: string): Promise<void> {
    await this.expect('DELETE', `/dal/graphs/${graphId}`, [200, 204]);
  }

  run(graphId: string, body: RunBody): Promise<RunResponse> {
    return this.expect('POST', `/dal/graphs/${graphId}/run`, [200], { body });
  }

  topology(graphId: string): Promise<Topology> {
    return this.expect('GET', `/dal/graphs/${graphId}/topology`, [200]);
  }

  entities(graphId: string, body: EntitiesBody): Promise<EntitiesResponse> {
    return this.expect('POST', `/dal/graphs/${graphId}/entities`, [200], { body });
  }

  /** Returns the cached artefact or null on a miss. */
  async cacheGet<T>(graphId: string, artifact: Artifact, key?: string): Promise<T | null> {
    const res = await this.t.request<T>('GET', `/dal/cache/${graphId}/${artifact}`, { query: { key } });
    if (res.status === 404) return null;
    if (res.status !== 200) throw new ServiceCallError(`DAL cache get -> ${res.status}`, res.status, res.body);
    return res.body;
  }

  async cachePut(graphId: string, artifact: Artifact, value: unknown, key?: string): Promise<void> {
    await this.expect('PUT', `/dal/cache/${graphId}/${artifact}`, [200, 204], { body: value, query: { key } });
  }

  async cacheDelete(graphId: string): Promise<void> {
    await this.expect('DELETE', `/dal/cache/${graphId}`, [200, 204]);
  }

  colors(): Promise<ColorMap> {
    return this.expect('GET', '/dal/colors', [200]);
  }

  assignColors(kinds: string[]): Promise<ColorMap> {
    return this.expect('POST', '/dal/colors', [200], { body: { kinds } });
  }

  expire(): Promise<ExpireResponse> {
    return this.expect('POST', '/dal/maintenance/expire', [200]);
  }
}
