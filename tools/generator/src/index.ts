import prand from 'pure-rand';
import type { InputEdgeGroup, InputGraph, InputNode } from '@gd/api-contract';

export interface GenerateOptions {
  seed: number;
  nodes: number;
  edges: number;
  /** Number of layers of the generated DAG (callers on the left, datastores on the right). */
  layers?: number;
  /** Adds the quirks of real inputs: string `to`, missing targets, cycles, padding/casing noise. */
  quirks?: boolean;
}

const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const CWES = ['CWE-22: Path Traversal', 'CWE-79: XSS', 'CWE-89: SQL Injection', 'CWE-502: Deserialization'];

/**
 * Seeded synthetic graph generator (WorkPlan D7). The same options always produce the same graph, in the
 * *input* JSON format of the application.
 */
export function generateGraph(options: GenerateOptions): InputGraph {
  const { seed, nodes: nodeCount, quirks = false } = options;
  const layerCount = Math.max(2, Math.min(options.layers ?? 10, nodeCount));
  const rng = prand.xoroshiro128plus(seed);
  const int = (min: number, max: number) => prand.unsafeUniformIntDistribution(min, max, rng);
  const pad = String(nodeCount).length;
  const name = (i: number) => `svc-${String(i).padStart(pad, '0')}`;

  const layerOf = (i: number) => Math.min(layerCount - 1, Math.floor((i * layerCount) / nodeCount));
  const layers: number[][] = Array.from({ length: layerCount }, () => []);
  for (let i = 0; i < nodeCount; i++) layers[layerOf(i)].push(i);

  const nodes: InputNode[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const layer = layerOf(i);
    if (layer === layerCount - 1) {
      nodes.push({ name: name(i), kind: int(0, 1) === 0 ? 'rds' : 'sqs', metadata: { cloud: 'AWS' } });
      continue;
    }
    const node: InputNode = {
      name: name(i),
      kind: 'service',
      language: ['java', 'go', 'node'][int(0, 2)],
      path: `repo/${name(i)}`,
      publicExposed: layer === 0,
    };
    if (int(0, 19) === 0) {
      node.vulnerabilities = Array.from({ length: int(1, 2) }, () => ({
        file: `repo/${name(i)}/Handler${int(1, 9)}.java`,
        severity: SEVERITIES[int(0, SEVERITIES.length - 1)],
        message: 'generated finding',
        metadata: { cwe: CWES[int(0, CWES.length - 1)] },
      }));
    }
    nodes.push(node);
  }

  // Edges go from a layer to a later layer. The last ~2% of nodes stay isolated.
  const connectable = Math.max(2, Math.floor(nodeCount * 0.98));
  const seen = new Set<string>();
  const targets = new Map<number, number[]>();
  // number of possible forward pairs, so that dense requests terminate
  let feasible = 0;
  for (let i = 0; i < layerCount - 1; i++) {
    const later = layers.slice(i + 1).reduce((s, l) => s + l.filter((n) => n < connectable).length, 0);
    feasible += layers[i].filter((n) => n < connectable).length * later;
  }
  const wanted = Math.min(options.edges, Math.floor(feasible * 0.6));
  let attempts = 0;
  while (seen.size < wanted && attempts++ < wanted * 20) {
    const from = int(0, connectable - 1);
    const fromLayer = layerOf(from);
    if (fromLayer >= layerCount - 1) continue;
    const toLayer = int(0, 3) === 0 ? int(fromLayer + 1, layerCount - 1) : fromLayer + 1;
    const pool = layers[toLayer].filter((n) => n < connectable);
    if (pool.length === 0) continue;
    const to = pool[int(0, pool.length - 1)];
    const key = `${from}>${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.set(from, [...(targets.get(from) ?? []), to]);
  }

  const edges: InputEdgeGroup[] = [];
  for (const from of [...targets.keys()].sort((a, b) => a - b)) {
    const to = targets
      .get(from)!
      .sort((a, b) => a - b)
      .map(name);
    edges.push({ from: name(from), to: quirks && to.length === 1 ? to[0] : to });
  }

  if (quirks) {
    edges.push({ from: name(0), to: ['ghost-service'] });
    const first = layers[0][0];
    const second = layers[1]?.[0];
    if (second !== undefined) edges.push({ from: name(second), to: [name(first)] }); // cycle back to a caller
    edges.push({ from: `  ${name(first).toUpperCase()}  `, to: [` ${name(layers[1]?.[0] ?? first)} `] }); // noise
  }
  return { nodes, edges };
}
