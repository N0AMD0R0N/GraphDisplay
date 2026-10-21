import Fastify, { type FastifyInstance } from 'fastify';
import { registerApi } from './api';
import { SERVER_DEFAULTS } from './constants';
import type { ServerDeps } from './types';

/** Public REST API (WorkPlan §3.6). It has no database connections: storage goes through the DAL. */
export function createServer(deps: ServerDeps): FastifyInstance {
  // queries are sent in the URL: allow long query strings
  const app = Fastify({
    logger: deps.logger ?? false,
    bodyLimit: SERVER_DEFAULTS.bodyLimit,
    http: { maxHeaderSize: SERVER_DEFAULTS.maxHeaderSize },
  });
  registerApi(app, deps);
  return app;
}
