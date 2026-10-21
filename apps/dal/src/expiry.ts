import type { GraphEngine } from '@gd/query-core';
import type { ExpireResponse } from '@gd/dal-contract';
import type { Cache } from './cache';
import { Lock } from './locks';

/**
 * Deletes expired graphs from Neo4j and Redis (A7.1). Only the replica holding `lock:expiry`
 * sweeps (A13.3); deletes are idempotent, so a crashed sweep is retried by any replica.
 */
export class ExpirySweeper {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly engine: GraphEngine,
    private readonly cache: Cache,
    private readonly lock: Lock,
    private readonly intervalSeconds: number,
    private readonly onError: (e: unknown) => void = () => undefined,
  ) {}

  private get leaseMs(): number {
    return Math.max(2000, this.intervalSeconds * 2000);
  }

  async sweep(): Promise<ExpireResponse> {
    const token = await this.lock.acquire(this.leaseMs);
    if (!token) return { skipped: true, reason: 'another replica holds the expiry lock', deleted: [] };
    const deleted: string[] = [];
    try {
      for (const graphId of await this.engine.findExpired(Date.now())) {
        await this.lock.renew(token, this.leaseMs);
        await this.engine.deleteGraph(graphId);
        await this.cache.deleteGraph(graphId);
        deleted.push(graphId);
      }
    } finally {
      await this.lock.release(token);
    }
    return { skipped: false, deleted };
  }

  start(): void {
    if (this.timer || this.intervalSeconds <= 0) return;
    this.timer = setInterval(() => {
      this.sweep().catch(this.onError);
    }, this.intervalSeconds * 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
