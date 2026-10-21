/**
 * Constants shared by the services and the UI: network defaults, process signals and HTTP names. Each app keeps the
 * constants that only it needs in its own `constants.ts`.
 */

/** The loopback address: the services listen and talk to each other here unless configured otherwise. */
export const LOCALHOST = '127.0.0.1';

/** Listen on every interface (needed inside a container). */
export const ALL_INTERFACES = '0.0.0.0';

/** Default ports of the services (in Docker the same services reach each other by name, see docker/compose.yaml). */
export const DEFAULT_PORTS = {
  dal: 4000,
  ingest: 5000,
  server: 3001,
  client: 5173,
} as const;

export const httpUrl = (host: string, port: number): string => `http://${host}:${port}`;

/** Where a service expects the others when nothing is configured. */
export const DEFAULT_URLS = {
  dal: httpUrl(LOCALHOST, DEFAULT_PORTS.dal),
  ingest: httpUrl(LOCALHOST, DEFAULT_PORTS.ingest),
  server: httpUrl(LOCALHOST, DEFAULT_PORTS.server),
} as const;

/** Signals that stop a service gracefully. */
export const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

export const HEADER_CONTENT_TYPE = 'content-type';
export const CONTENT_TYPE_JSON = 'application/json';
