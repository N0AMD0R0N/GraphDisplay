import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { IngestOutcome } from '@gd/ingest-contract';
import { SEED_WAIT } from './constants';
import { runPipeline } from './pipeline';
import type { PipelineDeps, SeedOptions } from './types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Boot-time seeding (A11). The seeder only reads the file: parsing, validation and storage are done by
 * the same pipeline that serves `POST /ingest/graphs`. Idempotent thanks to the content-hash graphId.
 */
export async function seedGraph(deps: PipelineDeps, opts: SeedOptions): Promise<IngestOutcome> {
  const { attempts = SEED_WAIT.attempts, delayMs = SEED_WAIT.delayMs, log = () => undefined } = opts;
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
