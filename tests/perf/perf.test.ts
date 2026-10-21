import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateGraph } from '@gd/generator';
import { createStack, group, leaf, rule, type Stack, type Json } from '../setup/stack';

/**
 * API response times on the expected scale: 1000 nodes and 10000 edges (WorkPlan D6, base plan).
 * Latency is NOT a pass/fail criterion at this stage: the timings are recorded in reports/perf-*.json.
 * The tests only require the API to answer correctly.
 */
jest.setTimeout(240_000);

let stack: Stack;
let graphId: string;
const timings: Record<string, number[]> = {};
const uploadMs: { upload?: number } = {};

async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    (timings[name] ??= []).push(Math.round((performance.now() - start) * 10) / 10);
  }
}

const percentile = (values: number[], p: number) => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

beforeAll(async () => {
  stack = await createStack();
  const graph = generateGraph({ seed: 1, nodes: 1000, edges: 10000, layers: 10 });
  const start = performance.now();
  const res = await stack.upload(graph, 'perf-1000x10000');
  uploadMs.upload = Math.round(performance.now() - start);
  expect(res.status).toBe(201);
  expect(res.body.counts).toMatchObject({ nodes: 1000, edges: 10000 });
  graphId = res.body.graphId;
});

afterAll(async () => {
  const summary = Object.fromEntries(
    Object.entries(timings).map(([name, v]) => [
      name,
      {
        runs: v.length,
        minMs: Math.min(...v),
        p50Ms: percentile(v, 50),
        p95Ms: percentile(v, 95),
        maxMs: Math.max(...v),
      },
    ]),
  );
  const dir = join(__dirname, '..', '..', 'reports');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `perf-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note: 'Recorded only: latency is not a pass/fail criterion at this stage.',
        graph: { nodes: 1000, edges: 10000, seed: 1 },
        uploadMs: uploadMs.upload,
        summary,
        runs: timings,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`performance report: ${file}\n${JSON.stringify(summary, null, 2)}`);
  await stack.close();
});

// each run starts from a different node, so no run is served from the result cache
const startNodes = ['svc-0010', 'svc-0020', 'svc-0030', 'svc-0040', 'svc-0050', 'svc-0060'];

describe('response times at 1000 nodes / 10000 edges', () => {
  it('standard query (20 conditions)', async () => {
    for (const start of startNodes) {
      const rules = [
        rule('first', 'name', 'eq', start),
        group(
          'or',
          ...Array.from({ length: 19 }, (_, i) => rule('any', 'name', 'eq', `svc-${String(900 + i).padStart(4, '0')}`)),
          rule('any', 'kind', 'eq', 'service'),
        ),
      ];
      const res = await timed('standard query (20 conditions, maxHops 3)', () =>
        stack.query(graphId, { query: leaf(...rules), maxHops: 3 }),
      );
      expect(res.status).toBe(200);
      expect(res.body.routes.length).toBeGreaterThan(0);
      expect(res.body.routes.every((r: { nodeIds: string[] }) => r.nodeIds[0] === start)).toBe(true);
    }
  });

  it('heavy query (70 conditions)', async () => {
    for (const start of startNodes) {
      const rules = [
        rule('first', 'name', 'eq', start),
        group(
          'or',
          ...Array.from({ length: 68 }, (_, i) => rule('any', 'name', 'eq', `svc-${String(800 + i).padStart(4, '0')}`)),
          rule('any', 'kind', 'eq', 'service'),
        ),
        rule('none', '_isSink', 'eq', true),
      ];
      const res = await timed('heavy query (70 conditions, maxHops 3)', () =>
        stack.query(graphId, { query: leaf(...rules), maxHops: 3 }),
      );
      expect(res.status).toBe(200);
      expect(res.body.routes.length).toBeGreaterThan(0);
    }
  });

  it('public entry to datastore with set operations', async () => {
    const res = await timed('set operation (intersect of two anchored queries, maxHops 3)', () =>
      stack.query(graphId, {
        query: {
          op: 'intersect',
          args: [leaf(rule('first', 'name', 'eq', 'svc-0005')), leaf(rule('any', 'kind', 'eq', 'service'))],
        },
        maxHops: 3,
      }),
    );
    expect(res.status).toBe(200);
  });

  it('graph view of 200 ranked nodes including server-side layout (cold, then cached)', async () => {
    const cold = await timed('view (cold: ranking + elk layout)', () =>
      stack.api.request<Json>('GET', `/graphs/${graphId}/view`),
    );
    expect(cold.status).toBe(200);
    expect(cold.body).toMatchObject({ totalNodes: 1000, shownNodes: 200 });
    for (let i = 0; i < 3; i++) {
      const warm = await timed('view (cached)', () => stack.api.request<Json>('GET', `/graphs/${graphId}/view`));
      expect(warm.body.shownNodes).toBe(200);
    }
  });

  it('schema and expand', async () => {
    const schema = await timed('schema', () => stack.api.request<Json>('GET', `/graphs/${graphId}/schema`));
    expect(schema.body.nodeCount).toBe(1000);
    const view = (await stack.api.request<Json>('GET', `/graphs/${graphId}/view`)).body;
    const visible = view.nodes.map((n: Json) => ({ id: n.node.id, x: n.x, y: n.y }));
    const res = await timed('expand a "+N" stub', () =>
      stack.api.request<Json>('POST', `/graphs/${graphId}/view/expand`, {
        body: { nodeId: view.stubs[0].nodeId, mode: 'neighbors', visible },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body.shownNodes).toBeGreaterThan(200);
  });
});
