import { parseSeverityScale, parseSinkKinds } from '@gd/graph-core';
import { ENV_VARS, INGEST_DEFAULTS, SEED_PIN_ENABLED } from './constants';
import type { IngestServiceConfig } from './types';

const num = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): IngestServiceConfig {
  return {
    port: num(env[ENV_VARS.port], INGEST_DEFAULTS.port),
    dalUrl: env[ENV_VARS.dalUrl] ?? INGEST_DEFAULTS.dalUrl,
    seedFile: env[ENV_VARS.seedFile] || undefined,
    seedName: env[ENV_VARS.seedName] || undefined,
    seedPin: env[ENV_VARS.seedPin] === SEED_PIN_ENABLED,
    maxUploadBytes: num(env[ENV_VARS.maxUploadBytes], INGEST_DEFAULTS.maxUploadBytes),
    sinkKinds: parseSinkKinds(env[ENV_VARS.sinkKinds]),
    severityScale: parseSeverityScale(env[ENV_VARS.severityScale]),
  };
}
