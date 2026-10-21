import { DalClient } from '@gd/dal-contract';
import { httpTransport } from '@gd/api-contract';
import { createIngestApp } from './app';
import { loadConfig } from './config';
import { seedGraph } from './seed';

async function main() {
  const config = loadConfig();
  const dal = new DalClient(httpTransport(config.dalUrl));
  const app = createIngestApp({ dal, config, maxUploadBytes: config.maxUploadBytes, logger: true });
  await app.listen({ port: config.port, host: '0.0.0.0' });

  if (config.seedFile) {
    seedGraph(
      { dal, config },
      { file: config.seedFile, pinned: config.seedPin, name: config.seedName, log: (m) => app.log.info(m) },
    ).catch((e) => app.log.error(e));
  }

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
