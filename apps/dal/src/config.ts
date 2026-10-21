export interface DalConfig {
  port: number;
  neo4jUri: string;
  neo4jUser: string;
  neo4jPassword: string;
  redisUrl: string;
  cacheTtlSeconds: number;
  expirySweepIntervalSeconds: number;
  neo4jTxTimeoutMs: number;
}

const num = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): DalConfig {
  return {
    port: num(env.DAL_PORT, 4000),
    neo4jUri: env.NEO4J_URI ?? 'bolt://127.0.0.1:7687',
    neo4jUser: env.NEO4J_USER ?? 'neo4j',
    neo4jPassword: env.NEO4J_PASSWORD ?? 'graphdisplay-dev',
    redisUrl: env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    cacheTtlSeconds: num(env.CACHE_TTL_SECONDS, 86_400),
    expirySweepIntervalSeconds: num(env.EXPIRY_SWEEP_INTERVAL_SECONDS, 300),
    neo4jTxTimeoutMs: num(env.NEO4J_TX_TIMEOUT_MS, 5000),
  };
}
