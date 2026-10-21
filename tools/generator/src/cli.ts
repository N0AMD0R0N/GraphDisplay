import { writeFileSync } from 'node:fs';
import { generateGraph } from './index';

// npm run gen -- --seed 1 --nodes 1000 --edges 10000 --out graph.json [--quirks]
const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const graph = generateGraph({
  seed: Number(arg('seed', '1')),
  nodes: Number(arg('nodes', '1000')),
  edges: Number(arg('edges', '10000')),
  layers: Number(arg('layers', '10')),
  quirks: args.includes('--quirks'),
});
const out = arg('out', '');
const json = JSON.stringify(graph, null, 2);
if (out) {
  writeFileSync(out, json + '\n');
  console.log(`wrote ${out}: ${graph.nodes.length} nodes, ${graph.edges?.length ?? 0} edge groups`);
} else {
  console.log(json);
}
