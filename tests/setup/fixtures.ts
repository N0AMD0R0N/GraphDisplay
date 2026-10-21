import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InputGraph } from '@gd/api-contract';

export const fixture = (name: string): InputGraph =>
  JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8')) as InputGraph;

/** The provided example input (`train-ticket-be.json`). */
export const sampleGraph = (): InputGraph =>
  JSON.parse(readFileSync(join(__dirname, '..', '..', 'train-ticket-be.json'), 'utf8')) as InputGraph;
