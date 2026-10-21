import { ALL_INTERFACES, DEFAULTS, SHUTDOWN_SIGNALS, httpTransport } from '@gd/api-contract';
import { DalClient } from '@gd/dal-contract';
import { IngestClient } from '@gd/ingest-contract';
import { createServer } from './app';
import { ENV_VARS, SERVER_DEFAULTS } from './constants';

const num = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
};

async function main() {
  const env = process.env;
  const dal = new DalClient(httpTransport(env[ENV_VARS.dalUrl] ?? SERVER_DEFAULTS.dalUrl));
  const ingest = new IngestClient(
    httpTransport(
      env[ENV_VARS.ingestUrl] ?? SERVER_DEFAULTS.ingestUrl,
      num(env[ENV_VARS.ingestTimeoutMs], SERVER_DEFAULTS.ingestTimeoutMs),
    ),
  );
  const app = createServer({
    dal,
    ingest,
    limits: {
      maxHops: num(env[ENV_VARS.maxHops], DEFAULTS.maxHops),
      defaultLimit: num(env[ENV_VARS.defaultLimit], DEFAULTS.limit),
    },
    maxUploadBytes: num(env[ENV_VARS.maxUploadBytes], SERVER_DEFAULTS.maxUploadBytes),
    logger: true,
  });
  await app.listen({ port: num(env[ENV_VARS.port], SERVER_DEFAULTS.port), host: ALL_INTERFACES });

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  for (const signal of SHUTDOWN_SIGNALS) process.on(signal, shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
