import { DEFAULT_PORTS, DEFAULT_URLS } from '@gd/api-contract';

/** Names of the environment variables the ingestion service reads (see config.ts and .env.example). */
export const ENV_VARS = {
  port: 'INGEST_PORT',
  dalUrl: 'DAL_URL',
  seedFile: 'SEED_FILE',
  seedName: 'SEED_NAME',
  seedPin: 'SEED_PIN',
  maxUploadBytes: 'MAX_UPLOAD_BYTES',
  sinkKinds: 'SINK_KINDS',
  severityScale: 'SEVERITY_SCALE',
} as const;

/** Used when a variable is not set. */
export const INGEST_DEFAULTS = {
  port: DEFAULT_PORTS.ingest,
  dalUrl: DEFAULT_URLS.dal,
  maxUploadBytes: 50 * 1024 * 1024,
} as const;

/** The value of SEED_PIN that pins the seeded graph. */
export const SEED_PIN_ENABLED = 'true';

/** How the seeder waits for the DAL to become healthy. */
export const SEED_WAIT = { attempts: 60, delayMs: 2000 } as const;

export const ERROR_CODES = {
  invalidGraph: 'INVALID_GRAPH',
  graphNotFound: 'GRAPH_NOT_FOUND',
  notImplemented: 'NOT_IMPLEMENTED',
  ingestFailed: 'INGEST_ERROR',
  /** Raised by Fastify when the body exceeds the upload limit. */
  bodyTooLarge: 'FST_ERR_CTP_BODY_TOO_LARGE',
} as const;

export const HEALTH = { ok: 'ok', degraded: 'degraded' } as const;
