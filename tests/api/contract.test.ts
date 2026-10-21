import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { parse } from 'yaml';
import { DEFAULT_CONFIG } from '@gd/graph-core';
import { injectTransport } from '@gd/api-contract';
import { IngestClient } from '@gd/ingest-contract';
import { createIngestApp } from '../../apps/ingest/src/app';
import { registerApi as registerDalApi } from '../../apps/dal/src/api';
import { registerApi as registerIngestApi } from '../../apps/ingest/src/api';
import { createServer } from '../../apps/server/src/app';
import { registerApi as registerServerApi } from '../../apps/server/src/api';
import { createDalInstance, type DalInstance, type Json } from '../setup/stack';

/**
 * Contract tests: every operation documented in the OpenAPI files exists in the code (path + method),
 * and every route of the services is documented.
 */
const root = join(__dirname, '..', '..');
const load = (path: string) =>
  parse(readFileSync(join(root, path), 'utf8')) as { paths: Record<string, Record<string, Json>> };
const METHODS = ['get', 'post', 'put', 'delete'];

const operations = (spec: ReturnType<typeof load>) =>
  Object.entries(spec.paths).flatMap(([path, item]) =>
    METHODS.filter((m) => item[m]).map((m) => ({
      method: m.toUpperCase(),
      url: path.replace(/\{(\w+)\}/g, ':$1'),
      op: item[m],
    })),
  );

/**
 * Every route a service registers (HEAD left out). Swagger UI's own asset routes under `<docsPrefix>/static` are
 * left out too; its page and the JSON / YAML document are part of the contract. The handlers are never called, so
 * the dependencies can be placeholders.
 */
async function registeredRoutes(register: (app: FastifyInstance) => void, docsPrefix: string): Promise<string[]> {
  const app = Fastify();
  const routes = new Set<string>();
  app.addHook('onRoute', (route) => {
    if (route.url.startsWith(`${docsPrefix}/static`) || route.url === `${docsPrefix}/`) return;
    for (const method of ([] as string[]).concat(route.method)) {
      if (method !== 'HEAD') routes.add(`${method} ${route.url}`);
    }
  });
  register(app);
  await app.ready();
  await app.close();
  return [...routes].sort();
}
const documented = (file: string) =>
  operations(load(file))
    .map((o) => `${o.method} ${o.url}`)
    .sort();
const placeholder = {} as never;

let dal: DalInstance;
beforeAll(async () => {
  dal = await createDalInstance();
});
afterAll(async () => {
  await dal.close();
});

describe('OpenAPI documents', () => {
  it.each([
    ['public API', 'packages/api-contract/openapi.yaml', 15],
    ['ingestion service', 'packages/ingest-contract/ingest.openapi.yaml', 8],
    ['data access layer', 'packages/dal-contract/dal.openapi.yaml', 17],
  ])('%s: valid structure with unique operation ids', (_name, file, count) => {
    const spec = load(file);
    const ops = operations(spec);
    expect(ops.map((o) => `${o.method} ${o.url}`)).toHaveLength(count);
    const ids = ops.map((o) => o.op.operationId);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    for (const o of ops) expect(Object.keys(o.op.responses ?? {}).length).toBeGreaterThan(0);
  });

  it('public API: every $ref resolves to a defined schema or response', () => {
    const text = readFileSync(join(root, 'packages/api-contract/openapi.yaml'), 'utf8');
    const spec = parse(text) as { components: { schemas: object; responses: object } };
    const refs = [...text.matchAll(/\$ref: '#\/components\/(schemas|responses)\/(\w+)'/g)];
    expect(refs.length).toBeGreaterThan(30);
    for (const [, kind, name] of refs) {
      expect(Object.keys((spec.components as Json)[kind])).toContain(name);
    }
  });
});

describe('the code implements the documented operations', () => {
  it('API server', async () => {
    const server = createServer({
      dal: dal.client,
      ingest: new IngestClient(
        injectTransport(createIngestApp({ dal: dal.client, config: DEFAULT_CONFIG, maxUploadBytes: 1000 })),
      ),
      limits: { maxHops: 50, defaultLimit: 1000 },
      maxUploadBytes: 1000,
    });
    await server.ready();
    for (const { method, url } of operations(load('packages/api-contract/openapi.yaml'))) {
      expect({ route: `${method} ${url}`, exists: server.hasRoute({ method: method as 'GET', url }) }).toEqual({
        route: `${method} ${url}`,
        exists: true,
      });
    }
    await server.close();
  });

  it('ingestion service', async () => {
    const app = createIngestApp({ dal: dal.client, config: DEFAULT_CONFIG, maxUploadBytes: 1000 });
    await app.ready();
    for (const { method, url } of operations(load('packages/ingest-contract/ingest.openapi.yaml'))) {
      expect({ route: `${method} ${url}`, exists: app.hasRoute({ method: method as 'GET', url }) }).toEqual({
        route: `${method} ${url}`,
        exists: true,
      });
    }
    await app.close();
  });

  it('data access layer', () => {
    for (const { method, url } of operations(load('packages/dal-contract/dal.openapi.yaml'))) {
      expect({ route: `${method} ${url}`, exists: dal.dal.app.hasRoute({ method: method as 'GET', url }) }).toEqual({
        route: `${method} ${url}`,
        exists: true,
      });
    }
  });
});

/** Registers a service's endpoints on a bare Fastify instance, with placeholder dependencies. */
const SERVICES = [
  {
    name: 'API server',
    spec: 'packages/api-contract/openapi.yaml',
    docs: '/docs',
    register: (app: FastifyInstance) =>
      registerServerApi(app, {
        dal: placeholder,
        ingest: placeholder,
        limits: { maxHops: 50, defaultLimit: 1000 },
        maxUploadBytes: 1000,
      }),
  },
  {
    name: 'ingestion service',
    spec: 'packages/ingest-contract/ingest.openapi.yaml',
    docs: '/ingest/docs',
    register: (app: FastifyInstance) =>
      registerIngestApi(app, { dal: placeholder, config: DEFAULT_CONFIG, maxUploadBytes: 1000 }),
  },
  {
    name: 'data access layer',
    spec: 'packages/dal-contract/dal.openapi.yaml',
    docs: '/dal/docs',
    register: (app: FastifyInstance) =>
      registerDalApi(app, {
        engine: placeholder,
        cache: placeholder,
        colors: placeholder,
        sweeper: placeholder,
        config: placeholder,
      }),
  },
];

describe.each(SERVICES)('$name', ({ spec, docs, register }) => {
  it('documents every route of the code, and nothing else', async () => {
    expect(await registeredRoutes(register, docs)).toEqual(documented(spec));
  });

  it(`serves its contract at ${docs}/json and ${docs}/yaml, and Swagger UI at ${docs}`, async () => {
    const app = Fastify();
    register(app);
    const json = await app.inject(`${docs}/json`);
    expect(json.statusCode).toBe(200);
    expect(json.json()).toEqual(load(spec));
    const yaml = await app.inject(`${docs}/yaml`);
    expect(parse(yaml.body)).toEqual(load(spec));
    const ui = await app.inject(docs);
    expect(ui.statusCode).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');
    await app.close();
  });
});
