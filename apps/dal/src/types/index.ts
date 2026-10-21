import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { GraphEngine } from '@gd/query-core';
import type { Cache } from '../cache';
import type { ColorRegistry } from '../colors';
import type { ExpirySweeper } from '../expiry';

/** Settings of one DAL replica (read from the environment, see config.ts). */
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

export interface Logger {
  warn(msg: string): void;
}

/** A colour: hue and lightness (saturation is fixed). */
export interface Slot {
  h: number;
  l: number;
}

/** Where the global kind -> colour map lives. */
export interface ColorStore {
  readAll(): Promise<Record<string, Slot>>;
  write(kind: string, slot: Slot): Promise<void>;
  withLock<T>(fn: () => Promise<T>): Promise<T>;
}

/** What createDal needs from the outside. */
export interface DalDeps {
  engine: GraphEngine;
  redis: Redis | null;
  config: DalConfig;
  logger?: boolean;
}

/** One running replica. */
export interface Dal {
  app: FastifyInstance;
  cache: Cache;
  sweeper: ExpirySweeper;
  colors: ColorRegistry;
  close(): Promise<void>;
}

/** The parts the endpoints (api.ts) work with. */
export interface DalServices {
  engine: GraphEngine;
  cache: Cache;
  colors: ColorRegistry;
  sweeper: ExpirySweeper;
  config: DalConfig;
}
