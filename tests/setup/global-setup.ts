import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

/**
 * Starts an isolated Neo4j and Redis with Testcontainers (WorkPlan D3). Set TEST_NEO4J_URI +
 * TEST_NEO4J_PASSWORD + TEST_REDIS_URL to use already running services instead (faster local loops);
 * set TEST_SKIP_SERVICES=1 to run only the tests that need no services.
 */
export const NEO4J_TEST_PASSWORD = 'graphdisplay-test-pw';

type Started = { neo4j?: StartedTestContainer; redis?: StartedTestContainer };
const holder = globalThis as unknown as { __gdContainers?: Started };

export default async function globalSetup(): Promise<void> {
  if (process.env.TEST_SKIP_SERVICES) return;
  if (process.env.TEST_NEO4J_URI && process.env.TEST_REDIS_URL) return;

  process.env.TESTCONTAINERS_RYUK_DISABLED = 'true'; // containers are stopped in global teardown
  const started: Started = {};
  holder.__gdContainers = started;

  const [neo4j, redis] = await Promise.all([
    new GenericContainer(process.env.TEST_NEO4J_IMAGE ?? 'neo4j:5.26.32-community')
      .withEnvironment({
        NEO4J_AUTH: `neo4j/${NEO4J_TEST_PASSWORD}`,
        NEO4J_server_memory_heap_max__size: '768m',
        NEO4J_server_memory_pagecache_size: '128m',
      })
      .withExposedPorts(7687)
      .withWaitStrategy(Wait.forLogMessage(/Started\./))
      .withStartupTimeout(240_000)
      .start(),
    new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
  ]);
  started.neo4j = neo4j;
  started.redis = redis;
  process.env.TEST_NEO4J_URI = `bolt://${neo4j.getHost()}:${neo4j.getMappedPort(7687)}`;
  process.env.TEST_NEO4J_PASSWORD = NEO4J_TEST_PASSWORD;
  process.env.TEST_REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
}
