// The example setup: runs Docker Compose (`npm start`) or the development setup (`npm run dev:example`)
// seeded with the example graph. The example's values live here only; the apps, docker/compose.yaml and tools/dev.mjs
// take the seed from the environment (SEED_GRAPH for Compose, SEED_FILE for dev, SEED_NAME, SEED_PIN).
//
// Usage: node tools/example.mjs start [docker compose up options, e.g. -d]
//        node tools/example.mjs dev
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXAMPLE_GRAPH = 'train-ticket-be.json';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const graph = resolve(root, env.EXAMPLE_GRAPH ?? EXAMPLE_GRAPH);
if (!existsSync(graph)) {
  console.error(`example graph not found: ${graph}`);
  process.exit(1);
}
const seedEnv = {
  SEED_GRAPH: graph,
  SEED_FILE: graph,
  SEED_NAME: env.SEED_NAME ?? basename(graph, extname(graph)),
  SEED_PIN: env.SEED_PIN ?? 'true',
};

const [mode, ...rest] = process.argv.slice(2);
const run = (cmd, args) =>
  spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...env, ...seedEnv },
  });

let result;
if (mode === 'start') {
  result = run('docker', [
    'compose',
    '-f',
    'docker/compose.yaml',
    '-f',
    'docker/compose.seed.yaml',
    'up',
    '--build',
    ...rest,
  ]);
} else if (mode === 'dev') {
  result = run('node', ['tools/dev.mjs', ...rest]);
} else {
  console.error('usage: node tools/example.mjs start|dev');
  process.exit(2);
}
process.exit(result.status ?? 1);
