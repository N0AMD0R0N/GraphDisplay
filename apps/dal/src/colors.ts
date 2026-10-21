import type { Redis } from 'ioredis';
import { DEFAULTS, PALETTE } from '@gd/api-contract';
import { hashString } from '@gd/query-core';
import { REDIS_KEYS } from './constants';
import { Lock } from './locks';
import type { ColorStore, Slot } from './types';

/** Kind -> colour assignment (WorkPlan §3.5). */

export const SATURATION = 65;
export const BASE_LIGHTNESS = 50;
export const ALT_LIGHTNESS = 34;
const HUE_STEP = 10;
const MIN_LIGHTNESS_GAP = 15;

export const UNKNOWN_COLOR = PALETTE.unknown;
/** Known kinds get fixed, well-separated hues. */
export const FIXED_KINDS: Record<string, Slot> = {
  service: { h: 215, l: BASE_LIGHTNESS },
  rds: { h: 28, l: BASE_LIGHTNESS },
  sqs: { h: 140, l: BASE_LIGHTNESS },
};
/**
 * Hues the UI uses for non-kind purposes; never assigned to a kind: the cyan accent of route highlights and
 * animated edges (pink to red is the vulnerability severity scale, so it must not mean anything else).
 */
export const RESERVED_SLOTS: Slot[] = [{ h: 190, l: BASE_LIGHTNESS }];

/** Circular hue distance in degrees, 0..180. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

export function distinctSlots(a: Slot, b: Slot): boolean {
  return hueDistance(a.h, b.h) >= DEFAULTS.colorMinHueDistance || Math.abs(a.l - b.l) >= MIN_LIGHTNESS_GAP;
}

export function slotToHex({ h, l }: Slot, s = SATURATION): string {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Deterministic colour slot for a kind that is distinct from every slot already taken. */
export function pickSlot(kind: string, taken: Slot[]): Slot {
  const fixed = FIXED_KINDS[kind];
  if (fixed) return fixed;
  const start = (parseInt(hashString(kind).slice(-6), 16) % 36) * HUE_STEP;
  const all = [...taken, ...RESERVED_SLOTS];
  for (const l of [BASE_LIGHTNESS, ALT_LIGHTNESS]) {
    for (let i = 0; i < 360 / HUE_STEP; i++) {
      const candidate = { h: (start + i * HUE_STEP) % 360, l };
      if (all.every((t) => distinctSlots(candidate, t))) return candidate;
    }
  }
  return { h: start, l: ALT_LIGHTNESS };
}

export class MemoryColorStore implements ColorStore {
  private readonly data: Record<string, Slot> = {};
  private chain: Promise<unknown> = Promise.resolve();
  async readAll() {
    return { ...this.data };
  }
  async write(kind: string, slot: Slot) {
    this.data[kind] = slot;
  }
  withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }
}

/** Append-only global colour map in Redis hash `colors:kinds`, guarded by a lock (A8). */
export class RedisColorStore implements ColorStore {
  private readonly lock: Lock;
  constructor(private readonly redis: Redis) {
    this.lock = new Lock(redis, REDIS_KEYS.colorsLock);
  }
  async readAll() {
    const raw = await this.redis.hgetall(REDIS_KEYS.colorMap);
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, JSON.parse(v) as Slot]));
  }
  async write(kind: string, slot: Slot) {
    await this.redis.hset(REDIS_KEYS.colorMap, kind, JSON.stringify(slot));
  }
  withLock<T>(fn: () => Promise<T>): Promise<T> {
    return this.lock.withLock(5000, 5000, fn);
  }
}

export class ColorRegistry {
  constructor(private store: ColorStore) {}

  async all(): Promise<Record<string, string>> {
    return this.toHex(await this.store.readAll());
  }

  /** Assigns colours to unseen kinds (first assignment wins, globally) and returns the full map. */
  async assign(kinds: string[]): Promise<Record<string, string>> {
    const wanted = [...new Set(kinds)].filter((k) => k !== 'unknown').sort();
    const existing = await this.store.readAll();
    if (wanted.every((k) => existing[k])) return this.toHex(existing);
    return this.store.withLock(async () => {
      const current = await this.store.readAll();
      for (const kind of wanted) {
        if (current[kind]) continue;
        const slot = pickSlot(kind, Object.values(current));
        current[kind] = slot;
        await this.store.write(kind, slot);
      }
      return this.toHex(current);
    });
  }

  private toHex(slots: Record<string, Slot>): Record<string, string> {
    const out: Record<string, string> = { unknown: UNKNOWN_COLOR };
    for (const [kind, slot] of Object.entries(slots)) out[kind] = slotToHex(slot);
    return out;
  }
}
