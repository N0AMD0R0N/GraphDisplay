import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

const RENEW = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

/** Redis lease lock (SET NX PX) with token-checked renew/release (A13.3). Without Redis it always succeeds. */
export class Lock {
  constructor(
    private readonly redis: Redis | null,
    private readonly key: string,
  ) {}

  async acquire(ttlMs: number): Promise<string | null> {
    if (!this.redis) return 'local';
    const token = randomUUID();
    const ok = await this.redis.set(this.key, token, 'PX', ttlMs, 'NX');
    return ok === 'OK' ? token : null;
  }

  async renew(token: string, ttlMs: number): Promise<boolean> {
    if (!this.redis) return true;
    return (await this.redis.eval(RENEW, 1, this.key, token, String(ttlMs))) === 1;
  }

  async release(token: string): Promise<void> {
    if (!this.redis) return;
    await this.redis.eval(RELEASE, 1, this.key, token);
  }

  /** Waits for the lock, then runs `fn`. */
  async withLock<T>(ttlMs: number, waitMs: number, fn: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + waitMs;
    let token = await this.acquire(ttlMs);
    while (!token && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
      token = await this.acquire(ttlMs);
    }
    if (!token) throw new Error(`could not acquire lock ${this.key}`);
    try {
      return await fn();
    } finally {
      await this.release(token);
    }
  }
}
