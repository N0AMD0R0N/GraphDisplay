// `npm run dev` (WorkPlan E5): the data tier (Neo4j, Redis, DAL replicas + load balancer) runs in Docker, the
// ingestion service, the API server and the client run locally with hot reload.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  CHILD_STOP_SIGNAL,
  COMPOSE_FILES,
  DEFAULT_PORTS,
  DOCKER_SERVICES,
  LOCALHOST,
  SHUTDOWN_SIGNALS,
  httpUrl,
} from './constants.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const env = process.env;
const port = {
  dal: env.DAL_LB_PORT ?? DEFAULT_PORTS.dal,
  ingest: env.INGEST_PORT ?? DEFAULT_PORTS.ingest,
  server: env.PORT ?? DEFAULT_PORTS.server,
  client: env.CLIENT_DEV_PORT ?? DEFAULT_PORTS.client,
};

console.log('> starting Neo4j, Redis, the DAL replicas and the DAL load balancer in Docker');
const compose = spawnSync(
  'docker',
  ['compose', ...COMPOSE_FILES.flatMap((file) => ['-f', file]), 'up', '-d', '--build', ...DOCKER_SERVICES],
  { cwd: root, stdio: 'inherit', shell: win },
);
if (compose.status !== 0) process.exit(compose.status ?? 1);

const children = [];
const start = (label, cmd, args, extraEnv = {}, cwd = root) => {
  const child = spawn(cmd, args, { cwd, shell: win, env: { ...env, ...extraEnv } });
  const pipe = (stream, out) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) out.write(`[${label}] ${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => console.log(`[${label}] exited with code ${code}`));
  children.push(child);
};

const dalUrl = httpUrl(LOCALHOST, port.dal);
start('ingest', 'npx', ['tsx', 'watch', 'apps/ingest/src/main.ts'], {
  INGEST_PORT: port.ingest,
  DAL_URL: dalUrl,
  // seeding is optional: SEED_FILE (a JSON file), SEED_NAME, SEED_PIN (npm run dev:example sets them)
  SEED_FILE: env.SEED_FILE ? resolve(env.SEED_FILE) : '',
  SEED_PIN: env.SEED_PIN ?? 'true',
});
start('server', 'npx', ['tsx', 'watch', 'apps/server/src/main.ts'], {
  PORT: port.server,
  DAL_URL: dalUrl,
  INGEST_URL: httpUrl(LOCALHOST, port.ingest),
});
start('client', 'npx', ['vite'], { API_URL: httpUrl(LOCALHOST, port.server) }, resolve(root, 'apps/client'));

console.log(
  `\n  client:  ${httpUrl(LOCALHOST, port.client)}\n  api:     ${httpUrl(LOCALHOST, port.server)}\n  stop:    Ctrl+C (the Docker services keep running; npm run stop removes them)\n`,
);

const shutdown = () => {
  for (const child of children) {
    if (win) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill(CHILD_STOP_SIGNAL);
  }
  process.exit(0);
};
for (const signal of SHUTDOWN_SIGNALS) process.on(signal, shutdown);
