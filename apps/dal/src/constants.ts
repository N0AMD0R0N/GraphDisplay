import { DEFAULT_PORTS, LOCALHOST } from '@gd/api-contract';

/** Names of the environment variables the DAL reads (see config.ts and .env.example). */
export const ENV_VARS = {
  port: 'DAL_PORT',
  neo4jUri: 'NEO4J_URI',
  neo4jUser: 'NEO4J_USER',
  neo4jPassword: 'NEO4J_PASSWORD',
  redisUrl: 'REDIS_URL',
  cacheTtlSeconds: 'CACHE_TTL_SECONDS',
  expirySweepIntervalSeconds: 'EXPIRY_SWEEP_INTERVAL_SECONDS',
  neo4jTxTimeoutMs: 'NEO4J_TX_TIMEOUT_MS',
} as const;

/** Used when a variable is not set. The password is the development default of docker/compose.yaml. */
export const DAL_DEFAULTS = {
  port: DEFAULT_PORTS.dal,
  neo4jUri: `bolt://${LOCALHOST}:7687`,
  neo4jUser: 'neo4j',
  neo4jPassword: 'graphdisplay-dev',
  redisUrl: `redis://${LOCALHOST}:6379`,
  cacheTtlSeconds: 86_400,
  expirySweepIntervalSeconds: 300,
  neo4jTxTimeoutMs: 5000,
} as const;

/** Redis key names (WorkPlan §3.4). */
export const REDIS_KEYS = {
  colorMap: 'colors:kinds',
  expiryLock: 'lock:expiry',
  colorsLock: 'lock:colors',
  /** The set of every cache key of a graph, so they can be deleted without SCAN. */
  graphKeys: (graphId: string) => `graph:${graphId}:keys`,
  graphArtifact: (graphId: string, artifact: string, key?: string) =>
    `graph:${graphId}:${artifact}${key ? `:${key}` : ''}`,
} as const;

/** Artefacts the cache accepts. */
export const CACHE_ARTIFACTS: ReadonlySet<string> = new Set(['schema', 'topology', 'layout', 'view', 'q']);

export const LOG_PREFIX = '[dal]';

/** Neo4j needs a while to boot: the DAL retries until it accepts connections. */
export const NEO4J_STARTUP = { attempts: 60, delayMs: 3000 } as const;

/** The OpenAPI contract of this service, served with Swagger UI at `routePrefix` (the document at /json and /yaml). */
export const OPENAPI_DOCS = {
  specFile: require.resolve('@gd/dal-contract/dal.openapi.yaml'),
  routePrefix: '/dal/docs',
} as const;
