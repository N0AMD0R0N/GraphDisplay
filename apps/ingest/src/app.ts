import Fastify, { type FastifyInstance } from 'fastify';
import { registerApi } from './api';
import type { IngestAppDeps } from './types';

export function createIngestApp(deps: IngestAppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: deps.maxUploadBytes });
  registerApi(app, deps);
  return app;
}
