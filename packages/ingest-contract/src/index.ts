import { ServiceCallError, type Transport, type UploadResponse, type ApiError } from '@gd/api-contract';

/** Internal ingestion service contract (ingest.openapi.yaml is the source of truth). */

export interface IngestOutcome {
  /** 201, 207 or 401, passed through unchanged by the API server (A14.1). */
  status: number;
  body: UploadResponse | ApiError;
}

export interface RebuildResponse {
  graphId: string;
  rebuilt: string[];
}

export class IngestClient {
  constructor(private readonly t: Transport) {}

  /** `body` is the raw request body (string) so invalid JSON is judged by the ingestion service. */
  async ingest(body: string | object, name?: string): Promise<IngestOutcome> {
    const res = await this.t.request<UploadResponse | ApiError>('POST', '/ingest/graphs', {
      body,
      query: { name },
    });
    return { status: res.status, body: res.body };
  }

  async rebuild(graphId: string): Promise<RebuildResponse | null> {
    const res = await this.t.request<RebuildResponse>('POST', `/ingest/graphs/${graphId}/rebuild`);
    if (res.status === 404) return null;
    if (res.status !== 200) throw new ServiceCallError(`ingest rebuild -> ${res.status}`, res.status, res.body);
    return res.body;
  }

  health(): Promise<{ status: string; dal: boolean }> {
    return this.t.request<{ status: string; dal: boolean }>('GET', '/ingest/health').then((r) => r.body);
  }
}
