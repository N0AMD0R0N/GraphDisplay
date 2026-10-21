import { Redis } from 'ioredis';
import { Neo4jEngine } from '@gd/engine-neo4j';
import { createDal } from './app';
import { loadConfig } from './config';

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
      if (attempt >= 60) throw e;
      console.log(`[dal] waiting for Neo4j (${attempt}): ${(e as Error).message}`);
      await sleep(3000);
    }
  }

  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2, enableOfflineQueue: false });
  redis.on('error', (e) => console.warn(`[dal] redis: ${e.message}`));

  const dal = createDal({ engine, redis, config, logger: true });
  dal.sweeper.start();
  await dal.app.listen({ port: config.port, host: '0.0.0.0' });

  const shutdown = async () => {
    await dal.close();
    redis.disconnect();
    await engine.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
