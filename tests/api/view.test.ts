import { generateGraph } from '@gd/generator';
import { fixture, sampleGraph } from '../setup/fixtures';
import { createStack, type Stack, type Json } from '../setup/stack';

let stack: Stack;
let sample: string;
let security: string;
let big: string;

// 400 nodes in a layered DAG: more than the 200-node view cap, plus a few isolated nodes
const bigGraph = () => generateGraph({ seed: 11, nodes: 400, edges: 1200, layers: 8 });

beforeAll(async () => {
  stack = await createStack();
  sample = await stack.uploadOk(sampleGraph());
  security = await stack.uploadOk(fixture('security.json'));
  big = await stack.uploadOk(bigGraph(), 'big-demo');
});
afterAll(async () => {
  await stack.close();
});

const view = (id: string, query = '') => stack.api.request<Json>('GET', `/graphs/${id}/view${query}`);

describe('GET /graphs/:id/view (WorkPlan C6.1, C7, B5)', () => {
  it('shows a small graph completely, with positions laid out left to right', async () => {
    const res = await view(security);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalNodes: 9, shownNodes: 9, stubs: [], hiddenComponentCount: 0 });
    expect(res.body.edges).toHaveLength(8);
    const x = Object.fromEntries(res.body.nodes.map((n: Json) => [n.node.id, n.x]));
    // callers on the left, callees on the right
    expect(x.web).toBeLessThan(x.api);
    expect(x.api).toBeLessThan(x.billing);
    expect(x.billing).toBeLessThan(x['ledger-db']);
    expect(x.worker).toBeLessThan(x.billing);
    for (const n of res.body.nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
  });

  it('returns the full original node properties for tooltips', async () => {
    const res = await view(security);
    const billing = res.body.nodes.find((n: Json) => n.node.id === 'billing').node;
    expect(billing.vulnerabilities).toHaveLength(2);
    expect(billing.vulnerabilities[0].severity).toBe('HIGH');
  });

  it('caps the view at 200 nodes, ranked by degree, and says how many exist', async () => {
    const res = await view(big);
    expect(res.body.totalNodes).toBe(400);
    expect(res.body.shownNodes).toBe(200);
    expect(res.body.nodes).toHaveLength(200);
    const shown = new Set(res.body.nodes.map((n: Json) => n.node.id));
    const minShown = Math.min(...res.body.nodes.map((n: Json) => n.degree));
    // every hidden node has a degree no greater than the least connected shown node
    const topology = await stack.dalClient.topology(big);
    for (const n of topology.nodes) if (!shown.has(n.id)) expect(n.degree).toBeLessThanOrEqual(minShown);
    for (const e of res.body.edges) expect(shown.has(e.from) && shown.has(e.to)).toBe(true);
  });

  it('attaches a "+N" stub to every shown node that has hidden neighbours, with the exact count', async () => {
    const res = await view(big);
    const shown = new Set(res.body.nodes.map((n: Json) => n.node.id));
    const topology = await stack.dalClient.topology(big);
    const neighbours = new Map<string, Set<string>>();
    for (const [a, b] of topology.edges) {
      (neighbours.get(a) ?? neighbours.set(a, new Set()).get(a)!).add(b);
      (neighbours.get(b) ?? neighbours.set(b, new Set()).get(b)!).add(a);
    }
    expect(res.body.stubs.length).toBeGreaterThan(0);
    for (const stub of res.body.stubs) {
      const hidden = [...(neighbours.get(stub.nodeId) ?? [])].filter((id) => !shown.has(id)).length;
      expect(stub.count).toBe(hidden);
      expect(stub.id).toBe(`stub:${stub.nodeId}`);
    }
    const stubbed = new Set(res.body.stubs.map((s: Json) => s.nodeId));
    for (const id of shown) {
      const hidden = [...(neighbours.get(id as string) ?? [])].filter((n) => !shown.has(n)).length;
      expect(stubbed.has(id)).toBe(hidden > 0);
    }
  });

  it('lists the groups that are not connected to the displayed nodes', async () => {
    const res = await view(big);
    expect(res.body.hiddenComponentCount).toBeGreaterThan(0);
    for (const c of res.body.hiddenComponents) {
      expect(c.size).toBeGreaterThanOrEqual(1);
      expect(c.sample.length).toBeGreaterThan(0);
    }
    const sizes = res.body.hiddenComponents.map((c: Json) => c.size);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
  });

  it('includes pinned nodes even when their degree would not make the cut (selected route stays visible)', async () => {
    const plain = await view(big);
    const shown = new Set(plain.body.nodes.map((n: Json) => n.node.id));
    const topology = await stack.dalClient.topology(big);
    const outsider = topology.nodes.find((n) => !shown.has(n.id))!;
    const pinned = await view(big, `?pin=${outsider.id}`);
    expect(pinned.body.shownNodes).toBe(200);
    expect(pinned.body.nodes.some((n: Json) => n.node.id === outsider.id)).toBe(true);
  });

  it('honours a smaller limit and caches the result (same positions on repeat calls)', async () => {
    const a = await view(sample, '?limit=20');
    const b = await view(sample, '?limit=20');
    expect(a.body.shownNodes).toBe(20);
    expect(b.body).toEqual(a.body);
    expect(a.body.stubs.length).toBeGreaterThan(0);
  });
});

describe('POST /graphs/:id/view/expand', () => {
  const expand = (id: string, body: unknown) => stack.api.request<Json>('POST', `/graphs/${id}/view/expand`, { body });

  it('loads the neighbours of a node behind a stub, keeping existing nodes where they are', async () => {
    const first = (await view(big)).body;
    const stub = [...first.stubs].sort((a: Json, b: Json) => b.count - a.count)[0];
    const visible = first.nodes.map((n: Json) => ({ id: n.node.id, x: n.x, y: n.y }));
    const res = await expand(big, { nodeId: stub.nodeId, mode: 'neighbors', visible });
    expect(res.status).toBe(200);
    expect(res.body.shownNodes).toBeGreaterThan(200);
    for (const v of visible) {
      const same = res.body.nodes.find((n: Json) => n.node.id === v.id);
      expect([same.x, same.y]).toEqual([v.x, v.y]);
    }
    const shown = new Set(res.body.nodes.map((n: Json) => n.node.id));
    // all neighbours of the expanded node are shown now (at most 200 are loaded per expansion)
    const topology = await stack.dalClient.topology(big);
    for (const [a, b] of topology.edges) {
      if (a === stub.nodeId) expect(shown.has(b)).toBe(true);
      if (b === stub.nodeId) expect(shown.has(a)).toBe(true);
    }
    expect(res.body.stubs.find((s: Json) => s.nodeId === stub.nodeId)).toBeUndefined();
    expect(res.body.edges.length).toBeGreaterThan(first.edges.length);
  });

  it('places the new nodes to the right of the existing ones, without overlapping them', async () => {
    const first = (await view(big)).body;
    const stub = first.stubs[0];
    const visible = first.nodes.map((n: Json) => ({ id: n.node.id, x: n.x, y: n.y }));
    const res = await expand(big, { nodeId: stub.nodeId, mode: 'neighbors', visible });
    const old = new Set(visible.map((v: Json) => v.id));
    const maxOldX = Math.max(...visible.map((v: Json) => v.x));
    for (const n of res.body.nodes) if (!old.has(n.node.id)) expect(n.x).toBeGreaterThan(maxOldX);
  });

  it('loads a hidden component (not connected to what is displayed)', async () => {
    const first = (await view(big)).body;
    const comp = first.hiddenComponents[0];
    const visible = first.nodes.map((n: Json) => ({ id: n.node.id, x: n.x, y: n.y }));
    const res = await expand(big, { nodeId: comp.rootId, mode: 'component', visible });
    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: Json) => n.node.id === comp.rootId)).toBe(true);
    expect(res.body.hiddenComponentCount).toBe(first.hiddenComponentCount - 1);
  });

  it('validates the request', async () => {
    expect((await expand(big, { nodeId: 'nope', mode: 'neighbors', visible: [] })).status).toBe(404);
    expect((await expand(big, { mode: 'neighbors' })).status).toBe(400);
    expect((await expand('ffffffffffffffff', { nodeId: 'x', mode: 'neighbors', visible: [] })).status).toBe(404);
  });
});
