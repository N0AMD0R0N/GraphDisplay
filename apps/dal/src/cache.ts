import type { Redis } from 'ioredis';

export interface Logger {
  warn(msg: string): void;
}

/**
 * Redis cache for derived artefacts (WorkPlan §3.4). All keys of a graph are tracked in
 * `graph:{id}:keys` so they can be deleted without SCAN. If Redis is unavailable the cache
 * degrades to misses and skipped writes (A7).
 */
export class Cache {
  constructor(
    private readonly redis: Redis | null,
    private readonly ttlSeconds: number,
    private readonly log: Logger = { warn: () => undefined },
  ) {}

  private key(graphId: string, artifact: string, key?: string): string {
    return `graph:${graphId}:${artifact}${key ? `:${key}` : ''}`;
  }

  private keysKey(graphId: string): string {
    return `graph:${graphId}:keys`;
  }

  async get(graphId: string, artifact: string, key?: string): Promise<string | null> {
    if (!this.redis) return null;
    try {
      return await this.redis.get(this.key(graphId, artifact, key));
    } catch (e) {
      this.log.warn(`cache get failed: ${(e as Error).message}`);
      return null;
    }
  }

  async put(graphId: string, artifact: string, value: string, key?: string): Promise<boolean> {
    if (!this.redis) return false;
    const k = this.key(graphId, artifact, key);
    try {
      await this.redis
        .multi()
        .set(k, value, 'EX', this.ttlSeconds)
        .sadd(this.keysKey(graphId), k)
        .expire(this.keysKey(graphId), this.ttlSeconds + 60)
        .exec();
      return true;
    } catch (e) {
      this.log.warn(`cache put failed: ${(e as Error).message}`);
      return false;
    }
  }

  /** Deletes every cached artefact of a graph. */
  async deleteGraph(graphId: string): Promise<void> {
    if (!this.redis) return;
    try {
      const keys = await this.redis.smembers(this.keysKey(graphId));
      if (keys.length > 0) await this.redis.del(...keys);
      await this.redis.del(this.keysKey(graphId));
    } catch (e) {
      this.log.warn(`cache delete failed: ${(e as Error).message}`);
    }
  }

  async ping(): Promise<boolean> {
    if (!this.redis) return false;
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
