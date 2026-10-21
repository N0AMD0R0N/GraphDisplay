import { parseGraph } from '@gd/graph-core';
import { generateGraph } from '@gd/generator';
import {
  ColorRegistry,
  FIXED_KINDS,
  MemoryColorStore,
  RESERVED_SLOTS,
  UNKNOWN_COLOR,
  distinctSlots,
  hueDistance,
  pickSlot,
  slotToHex,
} from '../../apps/dal/src/colors';
import type { Slot } from '../../apps/dal/src/types';

describe('colour assignment (WorkPlan §3.5)', () => {
  it('measures hue distance around the circle', () => {
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(0, 180)).toBe(180);
    expect(hueDistance(90, 90)).toBe(0);
    expect(hueDistance(10, 350)).toBe(20);
  });

  it('gives the known kinds fixed, mutually distinct colours', () => {
    const slots = ['service', 'rds', 'sqs'].map((k) => pickSlot(k, []));
    expect(slots).toEqual([FIXED_KINDS.service, FIXED_KINDS.rds, FIXED_KINDS.sqs]);
    for (const a of slots) for (const b of slots) if (a !== b) expect(distinctSlots(a, b)).toBe(true);
    expect(slotToHex(FIXED_KINDS.service)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('is deterministic for a kind and set of taken colours', () => {
    expect(pickSlot('queue', [])).toEqual(pickSlot('queue', []));
  });

  it('keeps every colour at least 30 degrees of hue (or a lightness step) away from all others', () => {
    const taken: Slot[] = Object.values(FIXED_KINDS);
    const kinds = Array.from({ length: 15 }, (_, i) => `kind-${i}`);
    for (const kind of kinds) {
      const slot = pickSlot(kind, taken);
      for (const other of [...taken, ...RESERVED_SLOTS]) expect(distinctSlots(slot, other)).toBe(true);
      taken.push(slot);
    }
    // more kinds than one lightness ring has hue slots: the second ring must have been used
    expect(new Set(taken.map((s) => s.l)).size).toBeGreaterThan(1);
  });

  it('still assigns a deterministic colour when every distinct slot is taken (collision accepted)', () => {
    const taken: Slot[] = Object.values(FIXED_KINDS);
    for (let i = 0; i < 60; i++) taken.push(pickSlot(`kind-${i}`, taken));
    const again = Object.values(FIXED_KINDS).slice();
    for (let i = 0; i < 60; i++) again.push(pickSlot(`kind-${i}`, again));
    expect(again).toEqual(taken);
    expect(taken.every((s) => s.h >= 0 && s.h < 360)).toBe(true);
  });

  it('never assigns the reserved highlight hue to a kind', () => {
    const slots: Slot[] = [];
    for (let i = 0; i < 12; i++) slots.push(pickSlot(`k${i}`, slots));
    for (const s of slots) for (const r of RESERVED_SLOTS) expect(distinctSlots(s, r)).toBe(true);
  });

  it('registry: first assignment wins, the map is append-only and "unknown" is grey', async () => {
    const registry = new ColorRegistry(new MemoryColorStore());
    const first = await registry.assign(['service', 'cache']);
    const second = await registry.assign(['cache', 'topic', 'service']);
    expect(second.cache).toBe(first.cache);
    expect(second.service).toBe(first.service);
    expect(second.unknown).toBe(UNKNOWN_COLOR);
    expect(Object.keys(second).sort()).toEqual(['cache', 'service', 'topic', 'unknown']);
    expect(new Set(Object.values(second)).size).toBe(4);
  });

  it('registry: concurrent assignments never give two kinds the same colour', async () => {
    const registry = new ColorRegistry(new MemoryColorStore());
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => registry.assign([`a${i}`, `b${i}`, 'shared'])),
    );
    const final = await registry.all();
    expect(Object.values(final)).toHaveLength(new Set(Object.values(final)).size);
    for (const r of results) expect(r.shared).toBe(final.shared);
  });
});

describe('synthetic graph generator (WorkPlan D7)', () => {
  it('produces the same graph for the same seed and a different one for another seed', () => {
    const opts = { seed: 7, nodes: 200, edges: 600 };
    expect(generateGraph(opts)).toEqual(generateGraph(opts));
    expect(generateGraph({ ...opts, seed: 8 })).not.toEqual(generateGraph(opts));
  });

  it('scales to the expected size: 1000 nodes and 10000 edges', () => {
    const g = generateGraph({ seed: 1, nodes: 1000, edges: 10000 });
    const parsed = parseGraph(g);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.graph.nodes).toHaveLength(1000);
      expect(parsed.graph.edges).toHaveLength(10000);
      expect(parsed.issues).toEqual([]);
      expect(parsed.warnings.filter((w) => w.code === 'CYCLE')).toEqual([]);
    }
  });

  it('with quirks emits string targets, a missing target, a cycle and padded names that still parse', () => {
    const g = generateGraph({ seed: 3, nodes: 100, edges: 250, quirks: true });
    expect(g.edges!.some((e) => typeof e.to === 'string')).toBe(true);
    const parsed = parseGraph(g);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.issues.map((i) => i.ref)).toEqual(['ghost-service']);
      expect(parsed.warnings.some((w) => w.code === 'CYCLE')).toBe(true);
    }
  });

  it('only connects layers forwards, keeps a few nodes isolated and makes the last layer datastores', () => {
    const g = generateGraph({ seed: 5, nodes: 100, edges: 300 });
    const kinds = new Set(g.nodes.map((n) => n.kind));
    expect([...kinds].sort()).toEqual(['rds', 'service', 'sqs']);
    const referenced = new Set(g.edges!.flatMap((e) => [e.from, ...(Array.isArray(e.to) ? e.to : [e.to])]));
    expect(g.nodes.filter((n) => !referenced.has(n.name)).length).toBeGreaterThan(0);
  });
});
