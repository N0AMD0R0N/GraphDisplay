import type { DalClient } from '@gd/dal-contract';
import type { IngestConfig } from '@gd/graph-core';

/** Settings of the ingestion service: the derived-property settings plus the service's own. */
export interface IngestServiceConfig extends IngestConfig {
  port: number;
  dalUrl: string;
  seedFile: string | undefined;
  /** Name of the seeded graph; defaults to the file name. */
  seedName: string | undefined;
  seedPin: boolean;
  maxUploadBytes: number;
}

/** What createIngestApp needs from the outside. */
export interface IngestAppDeps {
  dal: DalClient;
  config: IngestConfig;
  maxUploadBytes: number;
  logger?: boolean;
}

/** What the pipeline works with: the DAL (the only way to store) and the derived-property settings. */
export interface PipelineDeps {
  dal: DalClient;
  config: IngestConfig;
}

export interface PipelineOptions {
  name?: string;
  pinned?: boolean;
}

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
