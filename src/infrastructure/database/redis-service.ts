/**
 * Redis Cache Service Implementation
 *
 * Provides:
 * - Generic cache operations (get, set, del) with TTL management
 * - Session context storage (session:{sessionId}:context) [TTL: 30 min]
 * - Tenant rate limit counters (tenant:{tenantId}:llm_calls) [TTL: 1 min]
 * - Key naming conventions for structured data access
 * - Connection retry with exponential backoff
 * - Graceful shutdown
 */

import Redis from 'ioredis';
import pino from 'pino';

import type { RedisConfig, ConnectionRetryConfig } from './types.js';

/** Default TTL values in seconds */
export const DEFAULT_TTL = {
  /** Session context TTL: 30 minutes */
  SESSION_CONTEXT: 30 * 60,
  /** Rate limit counter TTL: 1 minute */
  RATE_LIMIT: 60,
  /** Agent status TTL: 5 minutes */
  AGENT_STATUS: 5 * 60,
  /** Tool registry TTL: 5 minutes */
  TOOL_REGISTRY: 5 * 60,
} as const;

/** Key prefix patterns for structured Redis keys */
export const KEY_PREFIX = {
  SESSION_CONTEXT: 'session',
  USER_CONNECTIONS: 'user',
  TENANT_LLM_CALLS: 'tenant',
  AGENT_STATUS: 'agent',
  TOOLS_REGISTRY: 'tools',
} as const;

/** Session context data stored in Redis */
export interface SessionContext {
  sessionId: string;
  messages: Array<{ role: string; content: string; timestamp: string }>;
  metadata: Record<string, unknown>;
}

/** Default retry configuration for Redis connections */
const DEFAULT_RETRY_CONFIG: ConnectionRetryConfig = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * RedisCacheService provides cache operations, session context storage,
 * and rate limit counters backed by Redis.
 */
export class RedisCacheService {
  private client: Redis;
  private readonly logger: pino.Logger;
  private readonly config: RedisConfig;
  private isConnected: boolean = false;

  constructor(
    config: RedisConfig,
    options?: {
      retryConfig?: Partial<ConnectionRetryConfig>;
      logger?: pino.Logger;
    },
  ) {
    this.config = config;
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...options?.retryConfig };
    this.logger = (options?.logger ?? pino({ name: 'database-service' })).child({
      component: 'redis',
    });

    this.client = this.createClient(retryConfig);
    this.setupEventHandlers();
  }

  // --- Generic Cache Operations ---

  /**
   * Get a cached value by key.
   * Returns null if the key does not exist or has expired.
   */
  async cacheGet<T>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key);
      if (value === null) {
        return null;
      }
      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.error({ error, key }, 'Failed to get cache value');
      throw error;
    }
  }

  /**
   * Set a cached value with optional TTL.
   * If ttlSeconds is not provided, the key will not expire.
   */
  async cacheSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds !== undefined && ttlSeconds > 0) {
        await this.client.set(key, serialized, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, serialized);
      }
    } catch (error) {
      this.logger.error({ error, key }, 'Failed to set cache value');
      throw error;
    }
  }

  /**
   * Delete a cached value by key.
   */
  async cacheDel(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      this.logger.error({ error, key }, 'Failed to delete cache value');
      throw error;
    }
  }

  // --- Session Context Operations ---

  /**
   * Build the Redis key for a session context.
   */
  buildSessionContextKey(sessionId: string): string {
    return `${KEY_PREFIX.SESSION_CONTEXT}:${sessionId}:context`;
  }

  /**
   * Store session context with a 30-minute TTL.
   */
  async setSessionContext(sessionId: string, context: SessionContext): Promise<void> {
    const key = this.buildSessionContextKey(sessionId);
    await this.cacheSet(key, context, DEFAULT_TTL.SESSION_CONTEXT);
    this.logger.debug({ sessionId }, 'Session context stored');
  }

  /**
   * Retrieve session context. Returns null if expired or not found.
   */
  async getSessionContext(sessionId: string): Promise<SessionContext | null> {
    const key = this.buildSessionContextKey(sessionId);
    return this.cacheGet<SessionContext>(key);
  }

  /**
   * Delete session context (e.g., on session close).
   */
  async deleteSessionContext(sessionId: string): Promise<void> {
    const key = this.buildSessionContextKey(sessionId);
    await this.cacheDel(key);
    this.logger.debug({ sessionId }, 'Session context deleted');
  }

  // --- Tenant Rate Limit Counter Operations ---

  /**
   * Build the Redis key for a tenant's LLM call counter.
   */
  buildTenantLLMCallsKey(tenantId: string): string {
    return `${KEY_PREFIX.TENANT_LLM_CALLS}:${tenantId}:llm_calls`;
  }

  /**
   * Increment the tenant's LLM call counter.
   * Uses a 1-minute sliding window (TTL resets on first call in window).
   * Returns the current count after increment.
   */
  async incrementLLMCallCount(tenantId: string): Promise<number> {
    const key = this.buildTenantLLMCallsKey(tenantId);
    try {
      const pipeline = this.client.pipeline();
      pipeline.incr(key);
      pipeline.ttl(key);
      const results = await pipeline.exec();

      if (!results) {
        throw new Error('Pipeline execution returned null');
      }

      const [incrResult, ttlResult] = results;
      const count = incrResult[1] as number;
      const ttl = ttlResult[1] as number;

      // Set TTL only if the key is new (ttl === -1 means no expiry set)
      if (ttl === -1) {
        await this.client.expire(key, DEFAULT_TTL.RATE_LIMIT);
      }

      this.logger.debug({ tenantId, count }, 'LLM call count incremented');
      return count;
    } catch (error) {
      this.logger.error({ error, tenantId }, 'Failed to increment LLM call count');
      throw error;
    }
  }

  /**
   * Get the current LLM call count for a tenant.
   * Returns 0 if the counter has expired or does not exist.
   */
  async getLLMCallCount(tenantId: string): Promise<number> {
    const key = this.buildTenantLLMCallsKey(tenantId);
    try {
      const value = await this.client.get(key);
      return value !== null ? parseInt(value, 10) : 0;
    } catch (error) {
      this.logger.error({ error, tenantId }, 'Failed to get LLM call count');
      throw error;
    }
  }

  /**
   * Reset the LLM call counter for a tenant.
   */
  async resetLLMCallCount(tenantId: string): Promise<void> {
    const key = this.buildTenantLLMCallsKey(tenantId);
    await this.cacheDel(key);
    this.logger.debug({ tenantId }, 'LLM call count reset');
  }

  // --- Connection & Lifecycle ---

  /**
   * Check if the Redis client is connected.
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Get the underlying Redis client for advanced operations.
   * Use with caution - prefer the typed methods above.
   */
  getClient(): Redis {
    return this.client;
  }

  /**
   * Gracefully shut down the Redis connection.
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down Redis connection');
    await this.client.quit();
    this.isConnected = false;
  }

  // --- Private Methods ---

  /**
   * Create a new Redis client with retry configuration.
   */
  private createClient(retryConfig: ConnectionRetryConfig): Redis {
    return new Redis({
      host: this.config.host,
      port: this.config.port,
      password: this.config.password,
      db: this.config.db ?? 0,
      maxRetriesPerRequest: retryConfig.maxRetries,
      retryStrategy: (times: number) => {
        if (times > retryConfig.maxRetries) {
          this.logger.error(
            { attempts: times },
            'Redis connection retry limit reached - giving up',
          );
          return null;
        }
        const delay = Math.min(
          retryConfig.baseDelayMs * Math.pow(retryConfig.backoffMultiplier, times - 1),
          retryConfig.maxDelayMs,
        );
        this.logger.warn(
          { attempt: times, delayMs: delay },
          'Redis connection failed, retrying...',
        );
        return delay;
      },
      lazyConnect: false,
    });
  }

  /**
   * Set up event handlers for Redis client lifecycle events.
   */
  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      this.isConnected = true;
      this.logger.info('Redis client connected');
    });

    this.client.on('ready', () => {
      this.isConnected = true;
      this.logger.info('Redis client ready');
    });

    this.client.on('error', (error) => {
      this.logger.error({ error }, 'Redis client error');
    });

    this.client.on('close', () => {
      this.isConnected = false;
      this.logger.warn('Redis connection closed');
    });

    this.client.on('reconnecting', () => {
      this.logger.info('Redis client reconnecting...');
    });

    this.client.on('end', () => {
      this.isConnected = false;
      this.logger.info('Redis connection ended');
    });
  }
}
