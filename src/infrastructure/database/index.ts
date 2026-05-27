/**
 * Database Service
 *
 * Provides unified data access layer for PostgreSQL and Redis.
 * Manages connection pools and multi-tenant data isolation.
 */

export { PostgresDatabaseService } from './database-service.js';
export { RedisCacheService, DEFAULT_TTL, KEY_PREFIX } from './redis-service.js';
export type { SessionContext } from './redis-service.js';
export type {
  DatabaseService,
  DatabaseServiceConfig,
  PostgresConfig,
  RedisConfig,
  ConnectionRetryConfig,
  Transaction,
  PoolStats,
  QueryResult,
} from './types.js';
