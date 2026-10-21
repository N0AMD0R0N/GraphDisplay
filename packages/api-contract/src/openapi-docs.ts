import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { parse } from 'yaml';

/**
 * Serves a service's OpenAPI document and Swagger UI: `<prefix>` (the UI), `<prefix>/json` and `<prefix>/yaml`.
 * The document is the hand-written contract file, served as it is (static mode), so the contract stays the single
 * source of truth. Node only: not exported from the package index, which the browser bundle imports.
 */
export interface OpenApiDocsOptions {
  /** Path of the OpenAPI YAML file. */
  specFile: string;
  /** Where the UI and the document are served, e.g. `/docs`. */
  routePrefix: string;
}

export const loadOpenApi = (specFile: string): Record<string, unknown> =>
  parse(readFileSync(specFile, 'utf8')) as Record<string, unknown>;

export function registerOpenApiDocs(app: FastifyInstance, { specFile, routePrefix }: OpenApiDocsOptions): void {
  app.register(swagger, { mode: 'static', specification: { document: loadOpenApi(specFile) as never } });
  app.register(swaggerUi, { routePrefix });
}
