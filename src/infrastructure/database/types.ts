/**
 * Database Service Type Definitions
 *
 * Interfaces and types for the unified data access layer.
 */

import type { PoolClient } from 'pg';

/** PostgreSQL connection configuration */
export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  poolSize: number;
  /** Connection timeout in milliseconds */
  connectionTimeoutMs?: number;
  /** Idle timeout in milliseconds */
  idleTimeoutMs?: number;
  /** Statement timeout in milliseconds */
  statementTimeoutMs?: number;
}

/** Redis connection configuration */
export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  maxConnections: number;
  db?: number;
}

/** Full database service configuration */
export interface DatabaseServiceConfig {
  postgres: PostgresConfig;
  redis: RedisConfig;
}

/** Retry configuration for connection failures */
export interface ConnectionRetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

/** Transaction wrapper providing query access within a transaction */
export interface Transaction {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Access to the underlying pg PoolClient for advanced use */
  client: PoolClient;
}

/** Query result metadata */
export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

/** Connection pool statistics */
export interface PoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

/** Database service interface */
export interface DatabaseService {
  /** Execute a query with automatic tenant_id filtering */
  query<T>(sql: string, params: unknown[], tenantId: string): Promise<T[]>;
  /** Execute a transaction */
  transaction<T>(fn: (tx: Transaction) => Promise<T>, tenantId?: string): Promise<T>;
  /** Run database migrations */
  migrate(direction: 'up' | 'down'): Promise<void>;
  /** Get connection pool statistics */
  getPoolStats(): PoolStats;
  /** Gracefully shut down connections */
  shutdown(): Promise<void>;
}
