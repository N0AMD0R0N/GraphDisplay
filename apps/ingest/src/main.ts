import { DalClient } from '@gd/dal-contract';
import { ALL_INTERFACES, SHUTDOWN_SIGNALS, httpTransport } from '@gd/api-contract';
import { createIngestApp } from './app';
import { loadConfig } from './config';
import { seedGraph } from './seed';

async function main() {
  const config = loadConfig();
  const dal = new DalClient(httpTransport(config.dalUrl));
  const app = createIngestApp({ dal, config, maxUploadBytes: config.maxUploadBytes, logger: true });
  await app.listen({ port: config.port, host: ALL_INTERFACES });

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
  for (const signal of SHUTDOWN_SIGNALS) process.on(signal, shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
