import { DEFAULT_PORTS, DEFAULT_URLS } from '@gd/api-contract';

/** Names of the environment variables the API server reads (see main.ts and .env.example). */
export const ENV_VARS = {
  port: 'PORT',
  dalUrl: 'DAL_URL',
  ingestUrl: 'INGEST_URL',
  ingestTimeoutMs: 'INGEST_TIMEOUT_MS',
  maxHops: 'MAX_HOPS',
  defaultLimit: 'DEFAULT_LIMIT',
  maxUploadBytes: 'MAX_UPLOAD_BYTES',
} as const;

/** Used when a variable is not set. */
export const SERVER_DEFAULTS = {
  port: DEFAULT_PORTS.server,
  dalUrl: DEFAULT_URLS.dal,
  ingestUrl: DEFAULT_URLS.ingest,
  /** An upload waits for the ingestion service to finish. */
  ingestTimeoutMs: 120_000,
  maxUploadBytes: 50 * 1024 * 1024,
  /** Request bodies other than uploads (expand requests). */
  bodyLimit: 16 * 1024 * 1024,
  /** Queries travel in the URL: a 200-condition query is about 25 KB. */
  maxHeaderSize: 64 * 1024,
} as const;

/** The most node or edge ids one request may ask for (the URL carries them). */
export const MAX_ENTITY_IDS = 1000;

/** The id of the edge from one node to another (as in the routes). */
export const edgeId = (from: string, to: string): string => `${from}->${to}`;

export const ERROR_CODES = {
  notFound: 'NOT_FOUND',
  graphNotFound: 'GRAPH_NOT_FOUND',
  nodeNotFound: 'NODE_NOT_FOUND',
  routeNotFound: 'ROUTE_NOT_FOUND',
  tooManyIds: 'TOO_MANY_IDS',
  missingQuery: 'MISSING_QUERY',
  invalidQueryParam: 'INVALID_QUERY_PARAM',
  invalidQuery: 'INVALID_QUERY',
  invalidRequest: 'INVALID_REQUEST',
  unknownLanguage: 'UNKNOWN_LANGUAGE',
  queryFailed: 'QUERY_FAILED',
  upstream: 'UPSTREAM_ERROR',
  server: 'SERVER_ERROR',
  notImplemented: 'NOT_IMPLEMENTED',
} as const;

export const HEALTH = { ok: 'ok', degraded: 'degraded', unreachable: 'unreachable' } as const;

/** Size of the boxes the layout reserves for nodes and "+N" stubs (the client draws them 120 x 56 and 56 x 28). */
export const LAYOUT_BOX = {
  node: { width: 120, height: 56 },
  stub: { width: 56, height: 28 },
} as const;

/** Prefix of the id of a "+N" stub node: `stub:<nodeId>`. */
export const STUB_ID_PREFIX = 'stub:';

/** The OpenAPI contract of this service, served with Swagger UI at `routePrefix` (the document at /json and /yaml). */
export const OPENAPI_DOCS = {
  specFile: require.resolve('@gd/api-contract/openapi.yaml'),
  routePrefix: '/docs',
} as const;
