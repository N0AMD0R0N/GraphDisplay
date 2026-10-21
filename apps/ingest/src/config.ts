import { parseSeverityScale, parseSinkKinds, type IngestConfig } from '@gd/graph-core';

export interface IngestServiceConfig extends IngestConfig {
  port: number;
  dalUrl: string;
  seedFile: string | undefined;
  /** Name of the seeded graph; defaults to the file name. */
  seedName: string | undefined;
  seedPin: boolean;
  maxUploadBytes: number;
}

const num = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): IngestServiceConfig {
  return {
    port: num(env.INGEST_PORT, 5000),
    dalUrl: env.DAL_URL ?? 'http://127.0.0.1:4000',
    seedFile: env.SEED_FILE || undefined,
    seedName: env.SEED_NAME || undefined,
    seedPin: env.SEED_PIN === 'true',
    maxUploadBytes: num(env.MAX_UPLOAD_BYTES, 50 * 1024 * 1024),
    sinkKinds: parseSinkKinds(env.SINK_KINDS),
    severityScale: parseSeverityScale(env.SEVERITY_SCALE),
  };
}
