/**
 * Transport abstraction for the internal service clients (DalClient, IngestClient).
 * Two implementations: HTTP (production) and in-process via `app.inject()` (tests, D3).
 */

export interface TransportRequest {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

export interface TransportResponse<T = unknown> {
  status: number;
  body: T;
}

export interface Transport {
  request<T = unknown>(method: string, path: string, opts?: TransportRequest): Promise<TransportResponse<T>>;
}

/** An unexpected status from an internal service call. */
export class ServiceCallError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ServiceCallError';
    this.status = status;
    this.body = body;
  }
}

function withQuery(path: string, query?: TransportRequest['query']): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined) params.set(k, String(v));
  const qs = params.toString();
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path;
}

function parseBody(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const serialize = (body: unknown): string | undefined =>
  body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);

export function httpTransport(baseUrl: string, timeoutMs = 60_000): Transport {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    async request<T>(method: string, path: string, opts: TransportRequest = {}) {
      const res = await fetch(`${base}${withQuery(path, opts.query)}`, {
        method,
        headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: serialize(opts.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { status: res.status, body: parseBody(await res.text()) as T };
    },
  };
}

export interface Injectable {
  inject(opts: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    url: string;
    payload?: string;
    headers?: Record<string, string>;
  }): PromiseLike<{ statusCode: number; body: string }>;
}

export function injectTransport(app: Injectable): Transport {
  return {
    async request<T>(method: string, path: string, opts: TransportRequest = {}) {
      const payload = serialize(opts.body);
      const res = await app.inject({
        method: method as 'GET' | 'POST' | 'PUT' | 'DELETE',
        url: withQuery(path, opts.query),
        payload,
        headers: payload !== undefined ? { 'content-type': 'application/json' } : undefined,
      });
      return { status: res.statusCode, body: parseBody(res.body) as T };
    },
  };
}
