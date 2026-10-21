// `npm run dev` (WorkPlan E5): the data tier (Neo4j, Redis, DAL replicas + load balancer) runs in Docker, the
// ingestion service, the API server and the client run locally with hot reload.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const env = process.env;
const port = { dal: env.DAL_LB_PORT ?? '4000', ingest: env.INGEST_PORT ?? '5000', server: env.PORT ?? '3001' };

console.log('> starting Neo4j, Redis, the DAL replicas and the DAL load balancer in Docker');
const compose = spawnSync(
  'docker',
  [
    'compose',
    '-f',
    'docker/compose.yaml',
    '-f',
    'docker/compose.dev.yaml',
    'up',
    '-d',
    '--build',
    'neo4j',
    'redis',
    'dal',
    'dal-lb',
  ],
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

const dalUrl = `http://127.0.0.1:${port.dal}`;
start('ingest', 'npx', ['tsx', 'watch', 'apps/ingest/src/main.ts'], {
  INGEST_PORT: port.ingest,
  DAL_URL: dalUrl,
  SEED_FILE: resolve(root, 'train-ticket-be.json'),
  SEED_NAME: env.SEED_NAME ?? 'train-ticket-be',
  SEED_PIN: 'true',
});
start('server', 'npx', ['tsx', 'watch', 'apps/server/src/main.ts'], {
  PORT: port.server,
  DAL_URL: dalUrl,
  INGEST_URL: `http://127.0.0.1:${port.ingest}`,
});
start('client', 'npx', ['vite'], { API_URL: `http://127.0.0.1:${port.server}` }, resolve(root, 'apps/client'));

console.log(
  `\n  client:  http://127.0.0.1:5173\n  api:     http://127.0.0.1:${port.server}\n  stop:    Ctrl+C (the Docker services keep running; npm run stop removes them)\n`,
);

const shutdown = () => {
  for (const child of children) {
    if (win) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
