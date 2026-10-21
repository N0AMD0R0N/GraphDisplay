import Fastify from 'fastify';
import { registerApi } from './api';
import { Cache } from './cache';
import { ColorRegistry, MemoryColorStore, RedisColorStore } from './colors';
import { REDIS_KEYS } from './constants';
import { ExpirySweeper } from './expiry';
import { Lock } from './locks';
import type { Dal, DalDeps } from './types';

/** Builds one DAL replica (WorkPlan §3.7): the only component that touches Neo4j and Redis. */
export function createDal({ engine, redis, config, logger = false }: DalDeps): Dal {
  const app = Fastify({ logger, bodyLimit: 256 * 1024 * 1024 });
  const log = { warn: (m: string) => app.log.warn(m) };
  const cache = new Cache(redis, config.cacheTtlSeconds, log);
  const colors = new ColorRegistry(redis ? new RedisColorStore(redis) : new MemoryColorStore());
  const sweeper = new ExpirySweeper(
    engine,
    cache,
    new Lock(redis, REDIS_KEYS.expiryLock),
    config.expirySweepIntervalSeconds,
    (e) => app.log.error(e),
  );

  registerApi(app, { engine, cache, colors, sweeper, config });

  return {
    app,
    cache,
    sweeper,
    colors,
    async close() {
      sweeper.stop();
      await app.close();
    },
  };
}
