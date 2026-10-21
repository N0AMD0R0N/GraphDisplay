import { DEFAULTS, httpTransport } from '@gd/api-contract';
import { DalClient } from '@gd/dal-contract';
import { IngestClient } from '@gd/ingest-contract';
import { createServer } from './app';

const num = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
};

async function main() {
  const env = process.env;
  const dal = new DalClient(httpTransport(env.DAL_URL ?? 'http://127.0.0.1:4000'));
  const ingest = new IngestClient(
    httpTransport(env.INGEST_URL ?? 'http://127.0.0.1:5000', num(env.INGEST_TIMEOUT_MS, 120_000)),
  );
  const app = createServer({
    dal,
    ingest,
    limits: { maxHops: num(env.MAX_HOPS, DEFAULTS.maxHops), defaultLimit: num(env.DEFAULT_LIMIT, DEFAULTS.limit) },
    maxUploadBytes: num(env.MAX_UPLOAD_BYTES, 50 * 1024 * 1024),
    logger: true,
  });
  await app.listen({ port: num(env.PORT, 3001), host: '0.0.0.0' });

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
