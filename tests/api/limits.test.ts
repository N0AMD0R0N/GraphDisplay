import { generateGraph } from '@gd/generator';
import { createStack, group, leaf, rule, type Stack } from '../setup/stack';

let stack: Stack;
let dense: string;

beforeAll(async () => {
  // a short transaction time limit makes the explosion guard observable
  stack = await createStack({ dal: { neo4jTxTimeoutMs: 60 } });
  dense = await stack.uploadOk(generateGraph({ seed: 4, nodes: 300, edges: 3500, layers: 6 }), 'dense');
});
afterAll(async () => {
  await stack.close();
});

describe('explosion guards (WorkPlan A4, A4.1)', () => {
  it('504 with code QUERY_TIMEOUT when enumerating all routes of a dense graph takes too long', async () => {
    const res = await stack.query(dense, { query: leaf(), maxHops: 50 });
    expect(res.status).toBe(504);
    expect(res.body.error).toMatchObject({ status: 504, code: 'QUERY_TIMEOUT' });
    expect(res.body.error.message).toContain('time limit');
  });

  it('a raw query that must enumerate everything (ORDER BY) is stopped the same way', async () => {
    const res = await stack.query(dense, {
      query: {
        op: 'leaf',
        text: 'MATCH p = (a:Node {graphId: $g})-[:CALLS*0..8]->(b:Node) RETURN p ORDER BY length(p) DESC',
      },
    });
    expect(res.status).toBe(504);
  });

  it('a raw query without ORDER BY streams and ends at the route limit', async () => {
    const res = await stack.query(dense, {
      query: { op: 'leaf', text: 'MATCH p = (a:Node {graphId: $g})-[:CALLS*0..8]->(b:Node) RETURN p' },
      limit: 50,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ truncated: true });
    expect(res.body.routes).toHaveLength(50);
  });

  it('stays healthy after a timeout and still answers selective queries', async () => {
    const res = await stack.query(dense, {
      query: leaf(rule('first', 'name', 'eq', 'svc-000'), { type: 'length', max: 2 }),
      maxHops: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(1);
  });

  it('a hop limit makes a bounded query on the same graph finish', async () => {
    const quick = await createStack({ dal: { neo4jTxTimeoutMs: 20_000 } });
    try {
      const id = await quick.uploadOk(generateGraph({ seed: 4, nodes: 300, edges: 3500, layers: 6 }), 'dense');
      const res = await quick.query(id, {
        query: { op: 'leaf', builder: group('and', rule('first', 'name', 'eq', 'svc-000')) },
        maxHops: 2,
      });
      expect(res.status).toBe(200);
      expect(res.body.routes.every((r: { length: number }) => r.length <= 3)).toBe(true);
    } finally {
      await quick.close();
    }
  });
});
