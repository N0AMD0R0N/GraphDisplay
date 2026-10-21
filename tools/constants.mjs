// Constants of the developer scripts (npm run dev).

export const LOCALHOST = '127.0.0.1';

/** Ports used when the environment does not set them (the same defaults as .env.example). */
export const DEFAULT_PORTS = { dal: '4000', ingest: '5000', server: '3001', client: '5173' };

export const COMPOSE_FILES = ['docker/compose.yaml', 'docker/compose.dev.yaml'];

/** The data tier runs in Docker during `npm run dev`; the other services run locally. */
export const DOCKER_SERVICES = ['neo4j', 'redis', 'dal', 'dal-lb'];

export const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'];

export const httpUrl = (host, port) => `http://${host}:${port}`;

/** Signal that stops a child process on POSIX (Windows uses taskkill). */
export const CHILD_STOP_SIGNAL = 'SIGTERM';
