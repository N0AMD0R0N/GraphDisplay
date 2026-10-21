import { DAL_DEFAULTS, ENV_VARS } from './constants';
import type { DalConfig } from './types';

const num = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): DalConfig {
  return {
    port: num(env[ENV_VARS.port], DAL_DEFAULTS.port),
    neo4jUri: env[ENV_VARS.neo4jUri] ?? DAL_DEFAULTS.neo4jUri,
    neo4jUser: env[ENV_VARS.neo4jUser] ?? DAL_DEFAULTS.neo4jUser,
    neo4jPassword: env[ENV_VARS.neo4jPassword] ?? DAL_DEFAULTS.neo4jPassword,
    redisUrl: env[ENV_VARS.redisUrl] ?? DAL_DEFAULTS.redisUrl,
    cacheTtlSeconds: num(env[ENV_VARS.cacheTtlSeconds], DAL_DEFAULTS.cacheTtlSeconds),
    expirySweepIntervalSeconds: num(env[ENV_VARS.expirySweepIntervalSeconds], DAL_DEFAULTS.expirySweepIntervalSeconds),
    neo4jTxTimeoutMs: num(env[ENV_VARS.neo4jTxTimeoutMs], DAL_DEFAULTS.neo4jTxTimeoutMs),
  };
}
