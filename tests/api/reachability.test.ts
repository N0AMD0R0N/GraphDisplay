import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { httpTransport, injectTransport, type Transport } from '@gd/api-contract';
import { DEFAULT_CONFIG, finalizeGraph, parseGraph } from '@gd/graph-core';
import { cypherLanguage } from '@gd/lang-cypher';
import { createIngestApp } from '../../apps/ingest/src/app';
import { createStack, leaf, type Json, type Stack } from '../setup/stack';

/**
 * Every operation of the three OpenAPI documents is reachable: a real request with valid input reaches the handler
 * and gets the expected status, and that status is one the document lists for the operation. The request tables
 * must cover the documents exactly, so a new operation cannot be added without a reachability check.
 *
 * In-process by default (server, ingestion service and DAL on the test Neo4j and Redis). With TEST_APP_URL set to a
 * running deployment (e.g. http://127.0.0.1:8090) the public API part goes through its nginx, twice: under `/api`
 * and at the root; a further block checks that a page load of a UI address gets the UI and of an API-only path the
 * API. The internal services are not published, so their part always runs in-process.
 */
const root = join(__dirname, '..', '..');
const METHODS = ['get', 'post', 'put', 'delete'] as const;
type Spec = { paths: Record<string, Record<string, { responses: Record<string, unknown> }>> };
const loadSpec = (file: string) => parse(readFileSync(join(root, file), 'utf8')) as Spec;
const documentedOperations = (spec: Spec) =>
  Object.entries(spec.paths)
    .flatMap(([path, item]) => METHODS.filter((m) => item[m]).map((m) => `${m.toUpperCase()} ${path}`))
    .sort();
const documentedStatuses = (spec: Spec, operation: string) => {
  const [method, path] = operation.split(' ');
  return Object.keys(spec.paths[path][method.toLowerCase()].responses).map(Number);
};

/** A request for one operation. `path` fills the path parameters; requests run in table order. */
interface Probe {
  operation: string;
  path: () => string;
  query?: () => Record<string, string | number | boolean | undefined>;
  body?: () => unknown;
  status: number;
  check?: (body: Json) => void;
}

/** A graph no other test uses (its id is a hash of its content), so deleting it is safe on a live deployment too. */
const marker = `reach-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const probeGraph = {
  nodes: [
    { name: `${marker}-web`, kind: 'service', publicExposed: true },
    { name: `${marker}-api`, kind: 'service' },
    { name: `${marker}-db`, kind: 'rds' },
  ],
  edges: [
    { from: `${marker}-web`, to: [`${marker}-api`] },
    { from: `${marker}-api`, to: `${marker}-db` },
  ],
};
const web = `${marker}-web`;
const api = `${marker}-api`;

function describeReachability(name: string, specFile: string, transport: () => Transport, probes: Probe[]) {
  const spec = loadSpec(specFile);

  describe(`${name}: every documented operation is reachable`, () => {
    it('the requests below cover every operation of the document', () => {
      expect([...new Set(probes.map((p) => p.operation))].sort()).toEqual(documentedOperations(spec));
    });

    it.each(probes.map((p) => [`${p.operation} -> ${p.status}`, p] as const))('%s', async (_title, probe) => {
      expect(documentedStatuses(spec, probe.operation)).toContain(probe.status);
      const method = probe.operation.split(' ')[0];
      const res = await transport().request<Json>(method, probe.path(), {
        query: probe.query?.(),
        body: probe.body?.(),
      });
      expect({
        operation: probe.operation,
        status: res.status,
        body: res.status === probe.status ? '' : res.body,
      }).toEqual({
        operation: probe.operation,
        status: probe.status,
        body: '',
      });
      probe.check?.(res.body);
    });
  });
}

const LIVE_URL = process.env.TEST_APP_URL?.replace(/\/+$/, '');

let stack: Stack;
let ingestApp: ReturnType<typeof createIngestApp>;
let ingestApi: Transport;
let dalApi: Transport;
beforeAll(async () => {
  stack = await createStack();
  ingestApp = createIngestApp({ dal: stack.dalClient, config: DEFAULT_CONFIG, maxUploadBytes: 50 * 1024 * 1024 });
  await ingestApp.ready();
  ingestApi = injectTransport(ingestApp);
  dalApi = injectTransport(stack.dal.dal.app);
});
afterAll(async () => {
  await ingestApp.close();
  await stack.close();
});

// ------------------------------------------------------------------------------------------- public API
/** The public API's requests; each run uploads the probe graph first and deletes it last. */
function publicProbes(): Probe[] {
  let graphId = '';
  return [
    {
      operation: 'POST /graphs',
      path: () => '/graphs',
      query: () => ({ name: marker }),
      body: () => probeGraph,
      status: 201,
      check: (body) => {
        graphId = body.graphId;
        expect(graphId).toMatch(/^[0-9a-f]{16}$/);
      },
    },
    {
      operation: 'GET /graphs',
      path: () => '/graphs',
      status: 200,
      check: (body) => expect(body.map((g: Json) => g.graphId)).toContain(graphId),
    },
    { operation: 'GET /graphs/{graphId}', path: () => `/graphs/${graphId}`, status: 200 },
    {
      operation: 'GET /graphs/{graphId}/nodes',
      path: () => `/graphs/${graphId}/nodes?id=${encodeURIComponent(web)}`,
      status: 200,
      check: (body) => expect(body.map((n: Json) => n.id)).toEqual([web]),
    },
    {
      operation: 'GET /graphs/{graphId}/nodes',
      path: () => `/graphs/${graphId}/nodes`,
      status: 200,
      check: (body) =>
        expect(body.map((n: Json) => n.id).sort()).toEqual([`${marker}-api`, `${marker}-db`, web].sort()),
    },
    {
      operation: 'GET /graphs/{graphId}/edges',
      path: () => `/graphs/${graphId}/edges?id=${encodeURIComponent(`${web}->${api}`)}`,
      status: 200,
      check: (body) => expect(body).toHaveLength(1),
    },
    {
      operation: 'GET /graphs/{graphId}/edges',
      path: () => `/graphs/${graphId}/edges`,
      status: 200,
      check: (body) =>
        expect(body.map((e: Json) => e.id).sort()).toEqual([`${web}->${api}`, `${api}->${marker}-db`].sort()),
    },
    { operation: 'GET /graphs/{graphId}/schema', path: () => `/graphs/${graphId}/schema`, status: 200 },
    { operation: 'GET /graphs/{graphId}/view', path: () => `/graphs/${graphId}/view`, status: 200 },
    {
      operation: 'POST /graphs/{graphId}/view/expand',
      path: () => `/graphs/${graphId}/view/expand`,
      body: () => ({ nodeId: web, mode: 'neighbors', visible: [] }),
      status: 200,
    },
    {
      operation: 'GET /graphs/{graphId}/routes/query',
      path: () => `/graphs/${graphId}/routes/query`,
      query: () => ({ q: JSON.stringify(leaf()), limit: 100, maxHops: 5, routeMode: 'all' }),
      status: 200,
      check: (body) => expect(body.routes[0].nodeIds).toEqual([web, api, `${marker}-db`]),
    },
    { operation: 'GET /graphs/{graphId}/links', path: () => `/graphs/${graphId}/links`, status: 501 },
    { operation: 'POST /graphs/{graphId}/links', path: () => `/graphs/${graphId}/links`, status: 501 },
    { operation: 'GET /health', path: () => '/health', status: 200 },
    { operation: 'GET /docs', path: () => '/docs', status: 200 },
    {
      operation: 'GET /docs/json',
      path: () => '/docs/json',
      status: 200,
      check: (body) => expect(body).toEqual(loadSpec('packages/api-contract/openapi.yaml')),
    },
    { operation: 'GET /docs/yaml', path: () => '/docs/yaml', status: 200 },
    // last: removes the probe graph
    { operation: 'DELETE /graphs/{graphId}', path: () => `/graphs/${graphId}`, status: 204 },
  ];
}

const publicBases = LIVE_URL ? [`${LIVE_URL}/api`, LIVE_URL] : [undefined];
for (const base of publicBases) {
  describeReachability(
    base ? `public API at ${base}` : 'public API',
    'packages/api-contract/openapi.yaml',
    () => (base ? httpTransport(base) : stack.api),
    publicProbes(),
  );
}

// A browser loading an address asks for HTML. The UI's addresses (the same paths as the graph and the route query)
// then get the UI; every other API path still gets the API.
(LIVE_URL ? describe : describe.skip)(`page loads at ${LIVE_URL ?? 'TEST_APP_URL'}`, () => {
  const pageLoad = (path: string) => fetch(`${LIVE_URL}${path}`, { headers: { accept: 'text/html,*/*;q=0.8' } });
  let id = '';
  beforeAll(async () => {
    const graphs = (await (await fetch(`${LIVE_URL}/api/graphs`)).json()) as { graphId: string }[];
    id = graphs[0]?.graphId ?? 'none';
  });

  it.each([
    ['/graphs/:id', () => `/graphs/${id}`],
    ['/graphs/:id/routes/query', () => `/graphs/${id}/routes/query?q=${encodeURIComponent(JSON.stringify(leaf()))}`],
  ])('%s gets the UI', async (_name, path) => {
    const res = await pageLoad(path());
    expect([res.status, res.headers.get('content-type')]).toEqual([200, expect.stringContaining('text/html')]);
  });

  it.each([
    ['/graphs', () => '/graphs'],
    ['/graphs/:id/schema', () => `/graphs/${id}/schema`],
    ['/graphs/:id/view', () => `/graphs/${id}/view`],
    ['/graphs/:id/nodes', () => `/graphs/${id}/nodes`],
    ['/graphs/:id/nodes?id=…', () => `/graphs/${id}/nodes?id=x`],
    ['/graphs/:id/edges', () => `/graphs/${id}/edges`],
    ['/graphs/:id/edges?id=…', () => `/graphs/${id}/edges?id=x`],
    ['/health', () => '/health'],
    ['/docs/json', () => '/docs/json'],
  ])('%s gets the API', async (_name, path) => {
    const res = await pageLoad(path());
    expect([res.status, res.headers.get('content-type')]).toEqual([200, expect.stringContaining('application/json')]);
  });

  it('/graphs/:id/links (reserved) answers 501 in the API error format', async () => {
    const res = await pageLoad(`/graphs/${id}/links`);
    expect([res.status, ((await res.json()) as Json).error.code]).toEqual([501, 'NOT_IMPLEMENTED']);
  });
});

// ------------------------------------------------------------------------------------------- ingestion service
let ingestedId = '';
describeReachability('ingestion service', 'packages/ingest-contract/ingest.openapi.yaml', () => ingestApi, [
  {
    operation: 'POST /ingest/graphs',
    path: () => '/ingest/graphs',
    query: () => ({ name: `${marker}-ingest` }),
    body: () => ({ ...probeGraph, nodes: [...probeGraph.nodes, { name: `${marker}-ingest-only`, kind: 'sqs' }] }),
    status: 201,
    check: (body) => {
      ingestedId = body.graphId;
      stack.graphIds.push(ingestedId); // removed when the stack closes
    },
  },
  {
    operation: 'POST /ingest/graphs/{id}/rebuild',
    path: () => `/ingest/graphs/${ingestedId}/rebuild`,
    status: 200,
  },
  { operation: 'POST /ingest/jobs', path: () => '/ingest/jobs', status: 501 },
  { operation: 'GET /ingest/jobs/{id}', path: () => '/ingest/jobs/any', status: 501 },
  { operation: 'GET /ingest/health', path: () => '/ingest/health', status: 200 },
  { operation: 'GET /ingest/docs', path: () => '/ingest/docs', status: 200 },
  { operation: 'GET /ingest/docs/json', path: () => '/ingest/docs/json', status: 200 },
  { operation: 'GET /ingest/docs/yaml', path: () => '/ingest/docs/yaml', status: 200 },
]);

// ------------------------------------------------------------------------------------------- DAL
const dalGraphId = `reach${Date.now().toString(16)}`.slice(0, 16);
const normalized = () => {
  const parsed = parseGraph(probeGraph);
  if (!parsed.ok) throw new Error('probe graph does not parse');
  return finalizeGraph(parsed.graph, DEFAULT_CONFIG).graph;
};
describeReachability('data access layer', 'packages/dal-contract/dal.openapi.yaml', () => dalApi, [
  {
    operation: 'PUT /dal/graphs/{id}',
    path: () => `/dal/graphs/${dalGraphId}`,
    body: () => ({ name: marker, graph: normalized(), warnings: [], pinned: false }),
    status: 201,
  },
  { operation: 'GET /dal/health', path: () => '/dal/health', status: 200 },
  { operation: 'GET /dal/graphs', path: () => '/dal/graphs', status: 200 },
  { operation: 'GET /dal/graphs/{id}', path: () => `/dal/graphs/${dalGraphId}`, status: 200 },
  {
    operation: 'POST /dal/graphs/{id}/run',
    path: () => `/dal/graphs/${dalGraphId}/run`,
    // the DAL runs compiled queries: compile a builder query the way the API server does
    body: () => ({
      query: cypherLanguage.compile(
        { type: 'group', combinator: 'and', rules: [] },
        { graphId: dalGraphId, maxHops: 3, limit: 10, routeMode: 'all' },
      ),
      limit: 10,
      maxHops: 3,
    }),
    status: 200,
  },
  { operation: 'GET /dal/graphs/{id}/topology', path: () => `/dal/graphs/${dalGraphId}/topology`, status: 200 },
  {
    operation: 'POST /dal/graphs/{id}/entities',
    path: () => `/dal/graphs/${dalGraphId}/entities`,
    body: () => ({ nodeIds: [web], edgeIds: [] }),
    status: 200,
  },
  {
    operation: 'PUT /dal/cache/{graphId}/{artifact}',
    path: () => `/dal/cache/${dalGraphId}/view`,
    query: () => ({ key: 'probe' }),
    body: () => ({ probe: true }),
    status: 204,
  },
  {
    operation: 'GET /dal/cache/{graphId}/{artifact}',
    path: () => `/dal/cache/${dalGraphId}/view`,
    query: () => ({ key: 'probe' }),
    status: 200,
  },
  { operation: 'DELETE /dal/cache/{graphId}', path: () => `/dal/cache/${dalGraphId}`, status: 204 },
  { operation: 'GET /dal/colors', path: () => '/dal/colors', status: 200 },
  { operation: 'POST /dal/colors', path: () => '/dal/colors', body: () => ({ kinds: ['service'] }), status: 200 },
  { operation: 'POST /dal/maintenance/expire', path: () => '/dal/maintenance/expire', status: 200 },
  { operation: 'GET /dal/docs', path: () => '/dal/docs', status: 200 },
  { operation: 'GET /dal/docs/json', path: () => '/dal/docs/json', status: 200 },
  { operation: 'GET /dal/docs/yaml', path: () => '/dal/docs/yaml', status: 200 },
  // last: removes the probe graph
  { operation: 'DELETE /dal/graphs/{id}', path: () => `/dal/graphs/${dalGraphId}`, status: 204 },
]);
