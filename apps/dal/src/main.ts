import { Redis } from 'ioredis';
import { ALL_INTERFACES, SHUTDOWN_SIGNALS } from '@gd/api-contract';
import { Neo4jEngine } from '@gd/engine-neo4j';
import { createDal } from './app';
import { loadConfig } from './config';
import { LOG_PREFIX, NEO4J_STARTUP } from './constants';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const config = loadConfig();
  const engine = new Neo4jEngine({
    uri: config.neo4jUri,
    user: config.neo4jUser,
    password: config.neo4jPassword,
    defaultTimeoutMs: config.neo4jTxTimeoutMs,
  });

  // Neo4j needs a while to boot: retry until it accepts connections.
  for (let attempt = 1; ; attempt++) {
    try {
      await engine.init();
      break;
    } catch (e) {
      if (attempt >= NEO4J_STARTUP.attempts) throw e;
      console.log(`${LOG_PREFIX} waiting for Neo4j (${attempt}): ${(e as Error).message}`);
      await sleep(NEO4J_STARTUP.delayMs);
    }
  }

  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2, enableOfflineQueue: false });
  redis.on('error', (e) => console.warn(`${LOG_PREFIX} redis: ${e.message}`));

  const dal = createDal({ engine, redis, config, logger: true });
  dal.sweeper.start();
  await dal.app.listen({ port: config.port, host: ALL_INTERFACES });

  const shutdown = async () => {
    await dal.close();
    redis.disconnect();
    await engine.close();
    process.exit(0);
  };
  for (const signal of SHUTDOWN_SIGNALS) process.on(signal, shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
