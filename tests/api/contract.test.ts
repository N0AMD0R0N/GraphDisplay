import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { DEFAULT_CONFIG } from '@gd/graph-core';
import { injectTransport } from '@gd/api-contract';
import { IngestClient } from '@gd/ingest-contract';
import { createIngestApp } from '../../apps/ingest/src/app';
import { createServer } from '../../apps/server/src/app';
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

let dal: DalInstance;
beforeAll(async () => {
  dal = await createDalInstance();
});
afterAll(async () => {
  await dal.close();
});

describe('OpenAPI documents', () => {
  it.each([
    ['public API', 'packages/api-contract/openapi.yaml', 12],
    ['ingestion service', 'packages/ingest-contract/ingest.openapi.yaml', 5],
    ['data access layer', 'packages/dal-contract/dal.openapi.yaml', 14],
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
