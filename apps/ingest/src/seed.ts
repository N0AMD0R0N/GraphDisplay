import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { IngestOutcome } from '@gd/ingest-contract';
import { runPipeline, type PipelineDeps } from './pipeline';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SeedOptions {
  file: string;
  pinned: boolean;
  /** Graph name; defaults to the file name without extension. */
  name?: string;
  /** Wait for the DAL (attempts x delayMs). */
  attempts?: number;
  delayMs?: number;
  log?: (msg: string) => void;
}

/**
 * Boot-time seeding (A11). The seeder only reads the file: parsing, validation and storage are done by
 * the same pipeline that serves `POST /ingest/graphs`. Idempotent thanks to the content-hash graphId.
 */
export async function seedGraph(deps: PipelineDeps, opts: SeedOptions): Promise<IngestOutcome> {
  const { attempts = 60, delayMs = 2000, log = () => undefined } = opts;
  for (let i = 1; ; i++) {
    const health = await deps.dal.health().catch(() => null);
    if (health?.status === 'ok') break;
    if (i >= attempts) throw new Error('DAL did not become healthy; seeding aborted');
    log(`waiting for the DAL (${i}/${attempts})`);
    await sleep(delayMs);
  }
  const text = await readFile(opts.file, 'utf8');
  const outcome = await runPipeline(
    text,
    { name: opts.name ?? basename(opts.file, extname(opts.file)), pinned: opts.pinned },
    deps,
  );
  log(`seeded ${opts.file}: HTTP ${outcome.status}`);
  return outcome;
}
